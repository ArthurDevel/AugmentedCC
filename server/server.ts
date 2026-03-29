/**
 * Custom Node.js Server for Quest 3 AR Desktop
 *
 * Single-process server on port 3000 that combines three systems:
 *
 * - Serves the Next.js app over HTTPS (mkcert certs)
 * - Runs headless Chrome via Puppeteer, screenshots /desktop at 3840x1080
 *   with transparency, and streams PNG frames over WebSocket
 * - Two WebSocket endpoints on the same HTTPS server:
 *   /ws/screencast — PNG frame broadcast + input forwarding to Chrome via CDP
 *   /ws/audio — mic audio from Quest decoded via ffmpeg, RMS levels broadcast
 */

import { readFileSync } from "fs";
import { createServer as createHttpsServer, type Server } from "https";
import { type IncomingMessage } from "http";
import { type Duplex } from "stream";
import { spawn, type ChildProcess } from "child_process";
import { URL } from "url";
import next from "next";
import puppeteer, { type Browser, type Page, type CDPSession } from "puppeteer";
import { WebSocketServer, WebSocket } from "ws";

// ============================================================================
// CONSTANTS
// ============================================================================

const PORT = 3000;
const VIEWPORT_WIDTH = 3840;
const VIEWPORT_HEIGHT = 1080;
const DESKTOP_URL = `https://localhost:${PORT}/desktop`;
const CERT_PATH = "certs/cert.pem";
const KEY_PATH = "certs/key.pem";
const AUDIO_SAMPLE_RATE = 16000;
const AUDIO_CHANNELS = 1;
const RMS_BROADCAST_INTERVAL_MS = 100;

// ============================================================================
// TYPES
// ============================================================================

/** Input event sent from VR client to control headless Chrome. */
interface InputEvent {
  type: "click" | "mousemove" | "scroll";
  x: number;
  y: number;
  deltaX?: number;
  deltaY?: number;
}

/** Audio level message broadcast to consumer clients. */
interface AudioLevelMessage {
  type: "level";
  rms: number;
}

/** State for a single audio producer connection. */
interface AudioProducerState {
  ffmpeg: ChildProcess;
  latestRms: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Reads TLS certificate and key from disk.
 * @returns Object with cert and key as strings
 */
function readTlsCerts(): { cert: string; key: string } {
  const cert = readFileSync(CERT_PATH, "utf-8");
  const key = readFileSync(KEY_PATH, "utf-8");
  return { cert, key };
}

/**
 * Computes RMS (root mean square) from a PCM f32le buffer.
 * Copies the buffer first to ensure proper Float32Array alignment.
 * @param data - Raw PCM buffer from ffmpeg (f32le format)
 * @returns RMS value between 0 and 1
 */
function computeRms(data: Buffer): number {
  // Copy to a fresh Uint8Array so the underlying ArrayBuffer is aligned
  const aligned = new Uint8Array(data);
  const floats = new Float32Array(aligned.buffer, 0, Math.floor(aligned.byteLength / 4));

  if (floats.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < floats.length; i++) {
    sum += floats[i] * floats[i];
  }
  return Math.sqrt(sum / floats.length);
}

/**
 * Spawns an ffmpeg process that decodes webm/opus stdin to f32le PCM stdout.
 * @returns The spawned ffmpeg child process
 */
function spawnFfmpegDecoder(): ChildProcess {
  return spawn("ffmpeg", [
    "-i", "pipe:0",
    "-f", "f32le",
    "-ar", String(AUDIO_SAMPLE_RATE),
    "-ac", String(AUDIO_CHANNELS),
    "pipe:1",
  ], {
    stdio: ["pipe", "pipe", "ignore"],
  });
}

/**
 * Broadcasts a JSON message to all open WebSocket clients in the set.
 * @param clients - Set of WebSocket connections
 * @param message - Object to JSON-serialize and send
 */
function broadcastJson(clients: Set<WebSocket>, message: object): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

/**
 * Sends a binary buffer to all open WebSocket clients in the set.
 * @param clients - Set of WebSocket connections
 * @param buffer - Binary data to send
 */
function broadcastBinary(clients: Set<WebSocket>, buffer: Buffer): void {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(buffer);
    }
  }
}

// ============================================================================
// MAIN HANDLERS
// ============================================================================

/**
 * Handles a screencast WebSocket connection. Receives input events from VR
 * clients and forwards them to headless Chrome via CDP.
 * @param ws - The WebSocket connection
 * @param cdpSession - Chrome DevTools Protocol session for input dispatch
 * @param screencastClients - Set of all connected screencast clients
 */
function handleScreencastConnection(
  ws: WebSocket,
  cdpSession: CDPSession,
  screencastClients: Set<WebSocket>,
): void {
  screencastClients.add(ws);

  ws.on("message", async (data) => {
    try {
      const event: InputEvent = JSON.parse(data.toString());
      await dispatchInputEvent(cdpSession, event);
    } catch (err) {
      console.error("[screencast] Failed to process input event:", err);
    }
  });

  ws.on("close", () => {
    screencastClients.delete(ws);
  });
}

/**
 * Dispatches an input event to headless Chrome via CDP.
 * @param cdp - Chrome DevTools Protocol session
 * @param event - The input event from the VR client
 */
async function dispatchInputEvent(cdp: CDPSession, event: InputEvent): Promise<void> {
  switch (event.type) {
    case "mousemove":
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: event.x,
        y: event.y,
      });
      break;

    case "click":
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: event.x,
        y: event.y,
        button: "left",
        clickCount: 1,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: event.x,
        y: event.y,
        button: "left",
        clickCount: 1,
      });
      break;

    case "scroll":
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: event.x,
        y: event.y,
        deltaX: event.deltaX ?? 0,
        deltaY: event.deltaY ?? 0,
      });
      break;

    default:
      console.warn("[screencast] Unknown input event type:", (event as InputEvent).type);
  }
}

/**
 * Handles an audio WebSocket connection for a producer (mic source).
 * Spawns an ffmpeg process to decode webm/opus to PCM, computes RMS,
 * and broadcasts levels to all consumers.
 * @param ws - The WebSocket connection from a producer
 * @param audioConsumers - Set of all connected consumer clients
 */
function handleAudioProducer(ws: WebSocket, audioConsumers: Set<WebSocket>): void {
  const ffmpeg = spawnFfmpegDecoder();
  const state: AudioProducerState = { ffmpeg, latestRms: 0 };

  // Read PCM output from ffmpeg, compute RMS
  ffmpeg.stdout!.on("data", (chunk: Buffer) => {
    state.latestRms = computeRms(chunk);
  });

  ffmpeg.on("error", (err) => {
    console.error("[audio] ffmpeg error:", err);
  });

  ffmpeg.on("close", (code) => {
    if (code !== 0 && code !== null) {
      console.warn("[audio] ffmpeg exited with code:", code);
    }
  });

  // Broadcast RMS to consumers at ~10Hz
  const broadcastInterval = setInterval(() => {
    const message: AudioLevelMessage = { type: "level", rms: state.latestRms };
    broadcastJson(audioConsumers, message);
  }, RMS_BROADCAST_INTERVAL_MS);

  // Pipe incoming webm/opus chunks to ffmpeg stdin
  ws.on("message", (data) => {
    if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (ffmpeg.stdin!.writable) {
        ffmpeg.stdin!.write(buf);
      }
    }
  });

  ws.on("close", () => {
    clearInterval(broadcastInterval);
    ffmpeg.stdin!.end();
    ffmpeg.kill("SIGTERM");
  });
}

/**
 * Handles an audio WebSocket connection for a consumer (level reader).
 * @param ws - The WebSocket connection from a consumer
 * @param audioConsumers - Set of all connected consumer clients
 */
function handleAudioConsumer(ws: WebSocket, audioConsumers: Set<WebSocket>): void {
  audioConsumers.add(ws);

  ws.on("close", () => {
    audioConsumers.delete(ws);
  });
}

/**
 * Runs the screenshot capture loop. Takes transparent PNG screenshots from
 * headless Chrome and broadcasts them to all connected screencast clients.
 * Skips identical frames to save bandwidth.
 * @param cdpSession - Chrome DevTools Protocol session
 * @param screencastClients - Set of all connected screencast clients
 */
async function runScreenshotLoop(
  cdpSession: CDPSession,
  screencastClients: Set<WebSocket>,
): Promise<void> {
  let lastBase64 = "";

  while (true) {
    try {
      if (screencastClients.size === 0) {
        // No clients connected, sleep briefly to avoid busy-waiting
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      const result = await cdpSession.send("Page.captureScreenshot", {
        format: "png",
        omitBackground: true,
      } as Record<string, unknown>);

      // Skip identical frames
      if (result.data === lastBase64) {
        continue;
      }
      lastBase64 = result.data;

      const pngBuffer = Buffer.from(result.data, "base64");
      broadcastBinary(screencastClients, pngBuffer);
    } catch (err) {
      console.error("[screenshot] Capture failed:", err);
      // Brief pause before retrying to avoid tight error loop
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Launches headless Chrome, navigates to the desktop page, and sets up
 * transparent background rendering.
 * @returns Object with the browser, page, and CDP session
 */
async function launchHeadlessChrome(): Promise<{
  browser: Browser;
  page: Page;
  cdpSession: CDPSession;
}> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--ignore-certificate-errors",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

  const cdpSession = await page.createCDPSession();

  // Set transparent background for AR passthrough
  await cdpSession.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });

  // Navigate to the desktop page served by this same server
  await page.goto(DESKTOP_URL, { waitUntil: "networkidle0" });
  console.log(`[chrome] Headless Chrome loaded ${DESKTOP_URL}`);

  return { browser, page, cdpSession };
}

/**
 * Main entry point. Sets up the HTTPS server with Next.js, WebSocket
 * endpoints, Puppeteer, and the screenshot loop.
 */
async function main(): Promise<void> {
  // Allow self-signed certs for Puppeteer connecting to our own server
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  // Read TLS certs
  const { cert, key } = readTlsCerts();

  // Initialize Next.js
  const dev = process.env.NODE_ENV !== "production";
  const nextApp = next({ dev });
  const nextHandler = nextApp.getRequestHandler();
  await nextApp.prepare();

  // Create HTTPS server
  const httpsServer: Server = createHttpsServer({ cert, key }, (req, res) => {
    nextHandler(req, res);
  });

  // WebSocket servers (noServer mode for manual upgrade routing)
  const screencastWss = new WebSocketServer({ noServer: true });
  const audioWss = new WebSocketServer({ noServer: true });

  // Client tracking
  const screencastClients = new Set<WebSocket>();
  const audioConsumers = new Set<WebSocket>();

  // Will be set once Puppeteer is ready
  let cdpSession: CDPSession | null = null;

  // Route WebSocket upgrades by URL path
  httpsServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "/", `https://localhost:${PORT}`);
    const pathname = url.pathname;

    if (pathname === "/ws/screencast") {
      screencastWss.handleUpgrade(request, socket, head, (ws) => {
        if (!cdpSession) {
          ws.close(1011, "Headless Chrome not ready");
          return;
        }
        screencastWss.emit("connection", ws, request);
      });
    } else if (pathname === "/ws/audio") {
      audioWss.handleUpgrade(request, socket, head, (ws) => {
        audioWss.emit("connection", ws, request);
      });
    } else {
      // Not a recognized WS endpoint, let Next.js handle (e.g. HMR)
      // Do nothing — socket will be handled by Next.js internally
    }
  });

  // Screencast WebSocket connections
  screencastWss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    console.log("[screencast] Client connected");
    handleScreencastConnection(ws, cdpSession!, screencastClients);
  });

  // Audio WebSocket connections — route by ?role= query param
  audioWss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    const url = new URL(request.url ?? "/", `https://localhost:${PORT}`);
    const role = url.searchParams.get("role");

    if (role === "producer") {
      console.log("[audio] Producer connected");
      handleAudioProducer(ws, audioConsumers);
    } else if (role === "consumer") {
      console.log("[audio] Consumer connected");
      handleAudioConsumer(ws, audioConsumers);
    } else {
      console.warn("[audio] Unknown role:", role);
      ws.close(1008, "Missing or invalid role query parameter");
    }
  });

  // Start listening
  httpsServer.listen(PORT, () => {
    console.log(`[server] HTTPS server running at https://localhost:${PORT}`);
  });

  // Launch headless Chrome and start screenshot loop
  const chrome = await launchHeadlessChrome();
  cdpSession = chrome.cdpSession;
  console.log("[server] Puppeteer ready, starting screenshot loop");

  // Run screenshot loop (never returns unless error)
  runScreenshotLoop(cdpSession, screencastClients);
}

main().catch((err) => {
  console.error("[server] Fatal error:", err);
  process.exit(1);
});
