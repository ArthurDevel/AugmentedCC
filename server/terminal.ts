/**
 * Terminal PTY Manager
 *
 * Manages node-pty terminal sessions with HTTP + WebSocket interfaces.
 * Imported by server.ts which handles routing — this module owns all
 * terminal lifecycle, I/O, and API response logic.
 */

import { type IncomingMessage, type ServerResponse } from "http";
import { type Duplex } from "stream";
import * as path from "path";
import * as pty from "node-pty";
import { WebSocketServer, WebSocket } from "ws";

// ============================================================================
// TYPES
// ============================================================================

type TerminalProfile = "shell" | "claude";

interface TerminalSession {
  pty: pty.IPty;
  profile: TerminalProfile;
  cwd: string;
}

// ============================================================================
// STATE
// ============================================================================

const terminals = new Map<string, TerminalSession>();
const terminalWss = new WebSocketServer({ noServer: true });

// ============================================================================
// PTY LIFECYCLE
// ============================================================================

function generateId(): string {
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function filteredEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
}

function resolvePath(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(process.env.HOME ?? "/", p.slice(1));
  }
  return path.resolve(p);
}

function createTerminal(profile: TerminalProfile, cwd?: string): string {
  const id = generateId();
  const shell = process.env.SHELL ?? "/bin/zsh";
  const defaultDir = profile === "claude" ? process.cwd() : process.env.HOME ?? "/";
  const workingDir = cwd ? resolvePath(cwd) : defaultDir;

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: workingDir,
    env: filteredEnv(),
  });

  terminals.set(id, { pty: ptyProcess, profile, cwd: workingDir });

  ptyProcess.onExit(() => {
    terminals.delete(id);
  });

  if (profile === "claude") {
    setTimeout(() => {
      ptyProcess.write("claude --dangerously-skip-permissions\r");
    }, 300);
  }

  console.log(`[terminal] Created ${profile} terminal ${id} in ${workingDir}`);
  return id;
}

function killTerminal(id: string): boolean {
  const session = terminals.get(id);
  if (!session) return false;
  session.pty.kill();
  terminals.delete(id);
  console.log(`[terminal] Killed terminal ${id}`);
  return true;
}

function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const session = terminals.get(id);
  if (!session) return false;
  session.pty.resize(cols, rows);
  return true;
}

function writeTerminal(id: string, data: string): boolean {
  const session = terminals.get(id);
  if (!session) return false;
  session.pty.write(data);
  return true;
}

function listTerminals(): Array<{ id: string; profile: TerminalProfile; cwd: string }> {
  return Array.from(terminals.entries()).map(([id, session]) => ({
    id,
    profile: session.profile,
    cwd: session.cwd,
  }));
}

// ============================================================================
// HTTP HANDLER
// ============================================================================

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Handles HTTP requests to /api/terminals*. Returns true if the request
 * was handled, false if it should fall through to Next.js.
 */
export async function handleTerminalHttp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "https://localhost:3000");
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  if (!pathname.startsWith("/api/terminals")) return false;

  // POST /api/terminals — create
  if (method === "POST" && pathname === "/api/terminals") {
    const body = await readBody(req);
    const parsed = JSON.parse(body || "{}") as { profile?: string; cwd?: string };
    const profile = (parsed.profile === "claude" ? "claude" : "shell") as TerminalProfile;
    const id = createTerminal(profile, parsed.cwd);
    jsonResponse(res, 201, { id });
    return true;
  }

  // GET /api/terminals — list
  if (method === "GET" && pathname === "/api/terminals") {
    jsonResponse(res, 200, listTerminals());
    return true;
  }

  // DELETE /api/terminals/:id
  const deleteMatch = pathname.match(/^\/api\/terminals\/([^/]+)$/);
  if (method === "DELETE" && deleteMatch) {
    const killed = killTerminal(deleteMatch[1]);
    jsonResponse(res, killed ? 200 : 404, { ok: killed });
    return true;
  }

  // POST /api/terminals/:id/resize
  const resizeMatch = pathname.match(/^\/api\/terminals\/([^/]+)\/resize$/);
  if (method === "POST" && resizeMatch) {
    const body = await readBody(req);
    const { cols, rows } = JSON.parse(body) as { cols: number; rows: number };
    const resized = resizeTerminal(resizeMatch[1], cols, rows);
    jsonResponse(res, resized ? 200 : 404, { ok: resized });
    return true;
  }

  // POST /api/terminals/:id/write
  const writeMatch = pathname.match(/^\/api\/terminals\/([^/]+)\/write$/);
  if (method === "POST" && writeMatch) {
    const body = await readBody(req);
    const { data } = JSON.parse(body) as { data: string };
    const written = writeTerminal(writeMatch[1], data);
    jsonResponse(res, written ? 200 : 404, { ok: written });
    return true;
  }

  return false;
}

// ============================================================================
// WEBSOCKET HANDLER
// ============================================================================

/**
 * Returns the shared terminal WebSocketServer (noServer mode).
 */
export function getTerminalWss(): WebSocketServer {
  return terminalWss;
}

/**
 * Handles a WebSocket upgrade for /ws/terminal/:id. Wires the WS
 * connection bidirectionally to the PTY session.
 */
export function handleTerminalUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  terminalId: string,
): void {
  const session = terminals.get(terminalId);
  if (!session) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  terminalWss.handleUpgrade(request, socket, head, (ws) => {
    console.log(`[terminal] WS connected to ${terminalId}`);

    const dataDisposable = session.pty.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const exitDisposable = session.pty.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "PTY exited");
      }
    });

    ws.on("message", (data) => {
      session.pty.write(data.toString());
    });

    ws.on("close", () => {
      console.log(`[terminal] WS disconnected from ${terminalId}`);
      dataDisposable.dispose();
      exitDisposable.dispose();
    });
  });
}
