/**
 * Virtual Desktop Page
 *
 * Renders dynamic iframe panels and terminal panes in a flex layout.
 * This page is loaded by headless Chrome (Puppeteer) and screenshotted
 * for the VR view.
 *
 * - Transparent background so AR passthrough shows through gaps
 * - Add/remove iframe panels via a toolbar
 * - Add terminal shell panes (backed by real PTY sessions via node-pty)
 * - Auto-layout: panels flex-shrink to fit as more are added
 * - Audio meter in the bottom-right corner (reads WS levels)
 */
"use client";

import "@xterm/xterm/css/xterm.css";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_PANELS = 6;
const PANEL_MAX_WIDTH = 1400;
const DEBUG_WINDOW_WIDTH = 400;
const DEBUG_WINDOW_HEIGHT = 480;

// ============================================================================
// TYPES
// ============================================================================

interface Panel {
  id: string;
  url: string | null;
}

interface TerminalPaneDescriptor {
  id: string;
  terminalId: string | null;
  profile: "shell" | "claude";
  initialCommand?: string;
}

interface VoiceDebugEntry {
  id: number;
  type: "transcript" | "tool_call" | "llm_response" | "error";
  text: string;
  timestamp: number;
}

// ============================================================================
// HELPERS
// ============================================================================

function generateId(): string {
  return `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// PAGE
// ============================================================================

export default function DesktopPage() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [terminalPanes, setTerminalPanes] = useState<TerminalPaneDescriptor[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [debugEntries, setDebugEntries] = useState<VoiceDebugEntry[]>([]);
  const [interimText, setInterimText] = useState("");
  const [focusedWindowId, setFocusedWindowId] = useState<string | null>(null);
  const nextEntryId = useRef(0);

  // Connect to /ws/voice to receive VoiceEvents (transcripts, tool calls, errors)
  // Also used bidirectionally to send simulated text input
  const voiceWsRef = useRef<WebSocket | null>(null);

  const closeFocusedWindow = useCallback(() => {
    if (!focusedWindowId) return;

    const panel = panels.find((p) => p.id === focusedWindowId);
    if (panel) {
      setPanels((prev) => prev.filter((p) => p.id !== focusedWindowId));
      setFocusedWindowId(null);
      return;
    }

    const termPane = terminalPanes.find((p) => p.id === focusedWindowId);
    if (termPane) {
      setTerminalPanes((prev) => prev.filter((p) => p.id !== focusedWindowId));
      if (termPane.terminalId) {
        fetch(`/api/terminals/${termPane.terminalId}`, { method: "DELETE" });
      }
      setFocusedWindowId(null);
    }
  }, [focusedWindowId, panels, terminalPanes]);

  const handleToolCallEvent = useCallback(async (tool: string, params: Record<string, unknown>) => {
    if (tool === "open_browser" && typeof params.url === "string") {
      const url = params.url;
      setPanels((prev) => {
        if (prev.length >= MAX_PANELS) return prev;
        return [...prev, { id: generateId(), url }];
      });
    } else if (tool === "open_terminal") {
      const command = typeof params.command === "string" ? params.command : undefined;
      const paneId = generateId();

      const res = await fetch("/api/terminals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: "shell" }),
      });
      if (!res.ok) {
        console.error(`[tool] Failed to create terminal: ${res.status}`);
        return;
      }
      const { id: terminalId } = (await res.json()) as { id: string };

      setTerminalPanes((prev) => [...prev, { id: paneId, terminalId, profile: "shell", initialCommand: command }]);
    } else if (tool === "close_window") {
      closeFocusedWindow();
    } else if (
      (tool === "run_command" && typeof params.command === "string") ||
      (tool === "ask_claude" && typeof params.prompt === "string")
    ) {
      const text = tool === "run_command"
        ? (params.command as string)
        : (params.prompt as string);

      const focusedPane = focusedWindowId
        ? terminalPanes.find((p) => p.id === focusedWindowId && p.terminalId)
        : null;
      const targetPane = focusedPane ?? [...terminalPanes].reverse().find((p) => p.terminalId);

      if (!targetPane?.terminalId) {
        console.warn(`[tool] ${tool}: no terminal available`);
        return;
      }

      const res = await fetch(`/api/terminals/${targetPane.terminalId}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: text + "\r" }),
      });
      if (!res.ok) {
        console.error(`[tool] ${tool}: write failed (${res.status})`);
      }
    }
  }, [closeFocusedWindow, focusedWindowId, terminalPanes]);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws/voice`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      ws = new WebSocket(url);

      ws.onopen = () => {
        voiceWsRef.current = ws;
      };

      ws.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data);
          let text = "";
          const type = event.type;
          if (event.type === "transcript") {
            if (!event.isFinal) {
              setInterimText(event.text ?? "");
              return;
            }
            setInterimText("");
            text = event.text;
          } else if (event.type === "tool_call") {
            text = `${event.tool}(${JSON.stringify(event.params)})`;
            handleToolCallEvent(event.tool, event.params);
          } else if (event.type === "llm_response") {
            text = event.raw;
          } else if (event.type === "error") {
            text = event.message;
          } else {
            return;
          }

          const entry: VoiceDebugEntry = {
            id: nextEntryId.current++,
            type,
            text,
            timestamp: event.timestamp ?? Date.now(),
          };
          setDebugEntries((prev) => [...prev, entry]);
        } catch { /* ignore non-JSON */ }
      };

      ws.onclose = () => {
        voiceWsRef.current = null;
        ws = null;
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => { ws?.close(); };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      voiceWsRef.current = null;
    };
  }, [handleToolCallEvent]);

  // Connect to /ws/audio as a consumer to receive live RMS levels
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws/audio?role=consumer`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      ws = new WebSocket(url);

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "level" && typeof msg.rms === "number") {
            setAudioLevel(msg.rms);
          }
        } catch { /* ignore non-JSON */ }
      };

      ws.onclose = () => {
        ws = null;
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => { ws?.close(); };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const clearDebugEntries = useCallback(() => {
    setDebugEntries([]);
  }, []);

  const sendSimulatedText = useCallback((text: string) => {
    const ws = voiceWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "simulate", text }));
    }
  }, []);

  const addPanel = useCallback(() => {
    setPanels((prev) => {
      if (prev.length >= MAX_PANELS) return prev;
      return [...prev, { id: generateId(), url: null }];
    });
  }, []);

  const removeLast = useCallback(() => {
    setPanels((prev) => prev.slice(0, -1));
  }, []);

  const removeById = useCallback((id: string) => {
    setPanels((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const setPanelUrl = useCallback((id: string, url: string) => {
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, url } : p)));
  }, []);

  const addTerminal = useCallback((profile: "shell" | "claude") => {
    setTerminalPanes((prev) => [...prev, { id: generateId(), terminalId: null, profile }]);
  }, []);

  const launchTerminal = useCallback(async (paneId: string, cwd: string) => {
    const pane = terminalPanes.find((p) => p.id === paneId);
    if (!pane) return;
    const res = await fetch("/api/terminals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: pane.profile, cwd: cwd || undefined }),
    });
    if (!res.ok) throw new Error(`Failed to create terminal: ${res.status}`);
    const { id: terminalId } = (await res.json()) as { id: string };
    setTerminalPanes((prev) =>
      prev.map((p) => (p.id === paneId ? { ...p, terminalId } : p)),
    );
  }, [terminalPanes]);

  const addShell = useCallback(() => addTerminal("shell"), [addTerminal]);
  const addClaude = useCallback(() => addTerminal("claude"), [addTerminal]);

  const removeTerminal = useCallback(async (paneId: string, terminalId: string | null) => {
    setTerminalPanes((prev) => prev.filter((p) => p.id !== paneId));
    if (terminalId) {
      await fetch(`/api/terminals/${terminalId}`, { method: "DELETE" });
    }
  }, []);

  const totalCount = panels.length + terminalPanes.length;

  return (
    <div className="desktop-root">
      <Toolbar
        onAdd={addPanel}
        onRemoveLast={removeLast}
        onAddShell={addShell}
        onAddClaude={addClaude}
        panelCount={panels.length}
      />

      <div className="panels-container">
        {totalCount === 0 && (
          <div className="empty-state">
            Click &quot;+ Add Panel&quot; or &quot;+ Shell&quot; to get started
          </div>
        )}
        {panels.map((panel) => (
          <IframePanel
            key={panel.id}
            panel={panel}
            isFocused={focusedWindowId === panel.id}
            onFocus={() => setFocusedWindowId(panel.id)}
            onRemove={removeById}
            onSetUrl={setPanelUrl}
          />
        ))}
        {terminalPanes.map((pane) => (
          <TerminalPane
            key={pane.id}
            pane={pane}
            isFocused={focusedWindowId === pane.id}
            onFocus={() => setFocusedWindowId(pane.id)}
            onLaunch={(cwd) => launchTerminal(pane.id, cwd)}
            onClose={() => removeTerminal(pane.id, pane.terminalId)}
          />
        ))}
      </div>

      <VoiceDebugWindow entries={debugEntries} onClear={clearDebugEntries} audioLevel={audioLevel} interim={interimText} onSend={sendSimulatedText} />
      <AudioMeter level={audioLevel} />
    </div>
  );
}

// ============================================================================
// TOOLBAR
// ============================================================================

function Toolbar({
  onAdd,
  onRemoveLast,
  onAddShell,
  onAddClaude,
  panelCount,
}: {
  onAdd: () => void;
  onRemoveLast: () => void;
  onAddShell: () => void;
  onAddClaude: () => void;
  panelCount: number;
}) {
  return (
    <div className="toolbar">
      <button onClick={onAdd} disabled={panelCount >= MAX_PANELS}>
        + Add Panel
      </button>
      <button onClick={onRemoveLast} disabled={panelCount === 0}>
        - Remove Panel
      </button>
      <button onClick={onAddShell}>+ Shell</button>
      <button onClick={onAddClaude}>+ Claude</button>
      <span className="panel-count">
        {panelCount} / {MAX_PANELS}
      </span>
    </div>
  );
}

// ============================================================================
// IFRAME PANEL
// ============================================================================

function IframePanel({
  panel,
  isFocused,
  onFocus,
  onRemove,
  onSetUrl,
}: {
  panel: Panel;
  isFocused: boolean;
  onFocus: () => void;
  onRemove: (id: string) => void;
  onSetUrl: (id: string, url: string) => void;
}) {
  const [urlInput, setUrlInput] = useState("");

  const handleSubmit = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    onSetUrl(panel.id, normalized);
  };

  return (
    <div
      className={`iframe-panel ${isFocused ? "iframe-panel--focused" : ""}`}
      style={{ maxWidth: PANEL_MAX_WIDTH }}
      onMouseDown={onFocus}
    >
      <div className="panel-header">
        <span className="panel-url">{panel.url ?? "New Panel"}</span>
        <button className="panel-close" onClick={() => onRemove(panel.id)}>
          x
        </button>
      </div>
      {panel.url ? (
        <div className="panel-iframe-wrapper">
          <iframe src={panel.url} className="panel-iframe" title={panel.url} />
          {!isFocused && <div className="panel-iframe-overlay" onMouseDown={onFocus} />}
        </div>
      ) : (
        <div className="panel-url-entry">
          <div className="panel-url-row">
            <input
              type="text"
              className="panel-url-input"
              placeholder="Enter URL…"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              autoFocus
            />
            <button className="panel-url-go" onClick={handleSubmit}>
              Go
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TERMINAL PANE
// ============================================================================

const TerminalPane = ({
  pane,
  isFocused,
  onFocus,
  onLaunch,
  onClose,
}: {
  pane: TerminalPaneDescriptor;
  isFocused: boolean;
  onFocus: () => void;
  onLaunch: (cwd: string) => void;
  onClose: () => void;
}) => {
  const label = pane.profile === "claude" ? "Claude" : "Shell";

  if (!pane.terminalId) {
    return (
      <div className={`iframe-panel ${isFocused ? "iframe-panel--focused" : ""}`} onMouseDown={onFocus}>
        <div className="panel-header">
          <span className="panel-url">New {label}</span>
          <button className="panel-close" onClick={onClose}>
            x
          </button>
        </div>
        <TerminalPathEntry label={label} onSubmit={onLaunch} />
      </div>
    );
  }

  return (
    <div className={`iframe-panel ${isFocused ? "iframe-panel--focused" : ""}`} onMouseDown={onFocus}>
      <div className="panel-header">
        <span className="panel-url">{label}</span>
        <button className="panel-close" onClick={onClose}>
          x
        </button>
      </div>
      <TerminalXterm terminalId={pane.terminalId} initialCommand={pane.initialCommand} />
    </div>
  );
};

function TerminalPathEntry({
  label,
  onSubmit,
}: {
  label: string;
  onSubmit: (cwd: string) => void;
}) {
  const [pathInput, setPathInput] = useState("");

  const handleSubmit = () => {
    onSubmit(pathInput.trim());
  };

  return (
    <div className="panel-url-entry">
      <div className="panel-url-row">
        <input
          type="text"
          className="panel-url-input"
          placeholder="Working directory (blank for default)…"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          autoFocus
        />
        <button className="panel-url-go" onClick={handleSubmit}>
          {label}
        </button>
      </div>
    </div>
  );
}

const TerminalXterm = ({ terminalId, initialCommand }: { terminalId: string; initialCommand?: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    const init = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (disposed || !containerRef.current) return;

      const fitAddon = new FitAddon();
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        theme: {
          background: "#1a1b26",
          foreground: "#a9b1d6",
          cursor: "#c0caf5",
          selectionBackground: "#33467c",
          black: "#15161e",
          red: "#f7768e",
          green: "#9ece6a",
          yellow: "#e0af68",
          blue: "#7aa2f7",
          magenta: "#bb9af7",
          cyan: "#7dcfff",
          white: "#a9b1d6",
          brightBlack: "#414868",
          brightRed: "#f7768e",
          brightGreen: "#9ece6a",
          brightYellow: "#e0af68",
          brightBlue: "#7aa2f7",
          brightMagenta: "#bb9af7",
          brightCyan: "#7dcfff",
          brightWhite: "#c0caf5",
        },
      });

      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);

      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        if (!disposed) terminal.loadAddon(new WebglAddon());
      } catch {
        // Canvas renderer fallback is fine
      }

      const refit = () => {
        if (disposed || !containerRef.current) return;
        fitAddon.fit();
      };
      refit();
      requestAnimationFrame(() => {
        requestAnimationFrame(refit);
      });

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/terminal/${terminalId}`,
      );

      ws.onopen = () => {
        fetch(`/api/terminals/${terminalId}/resize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cols: terminal.cols, rows: terminal.rows }),
        });
        if (initialCommand) {
          setTimeout(() => {
            ws.send(initialCommand + "\r");
          }, 300);
        }
      };

      ws.onmessage = (event) => {
        terminal.write(
          typeof event.data === "string" ? event.data : new Uint8Array(event.data as ArrayBuffer),
        );
      };

      ws.onclose = () => {
        terminal.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
      };

      terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      let resizeTimer: ReturnType<typeof setTimeout>;
      const observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (disposed) return;
          fitAddon.fit();
          if (ws.readyState === WebSocket.OPEN) {
            fetch(`/api/terminals/${terminalId}/resize`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cols: terminal.cols, rows: terminal.rows }),
            });
          }
        }, 100);
      });
      observer.observe(containerRef.current);

      cleanup = () => {
        clearTimeout(resizeTimer);
        observer.disconnect();
        ws.close();
        terminal.dispose();
      };
    };

    init();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [terminalId]);

  return <div ref={containerRef} className="panel-terminal" />;
};

// ============================================================================
// VOICE DEBUG WINDOW
// ============================================================================

type DebugTab = "log" | "input";

function VoiceDebugWindow({
  entries,
  onClear,
  audioLevel,
  interim,
  onSend,
}: {
  entries: VoiceDebugEntry[];
  onClear: () => void;
  audioLevel: number;
  interim: string;
  onSend: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
  const [position, setPosition] = useState({ x: 16, y: 80 });
  const [minimized, setMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<DebugTab>("log");
  const [inputText, setInputText] = useState("");

  const prevLength = useRef(entries.length);
  if (entries.length !== prevLength.current) {
    prevLength.current = entries.length;
    if (activeTab === "log") {
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 0);
    }
  }

  const handleDragStart = (e: MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: position.x,
      origY: position.y,
    };

    const handleMove = (ev: globalThis.MouseEvent) => {
      if (!dragRef.current) return;
      setPosition({
        x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      });
    };

    const handleUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  const handleSend = () => {
    if (inputText.trim()) {
      onSend(inputText.trim());
      setInputText("");
    }
  };

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false });
  };

  const typeClass = (type: VoiceDebugEntry["type"]): string => {
    switch (type) {
      case "transcript": return "debug-entry--transcript";
      case "tool_call": return "debug-entry--tool";
      case "llm_response": return "debug-entry--llm";
      case "error": return "debug-entry--error";
    }
  };

  const typeLabel = (type: VoiceDebugEntry["type"]): string => {
    switch (type) {
      case "transcript": return "STT";
      case "tool_call": return "CMD";
      case "llm_response": return "LLM";
      case "error": return "ERR";
    }
  };

  return (
    <div
      className="voice-debug-window"
      style={{
        left: position.x,
        top: position.y,
        width: DEBUG_WINDOW_WIDTH,
        height: minimized ? "auto" : DEBUG_WINDOW_HEIGHT,
      }}
    >
      <div className="voice-debug-titlebar" onMouseDown={handleDragStart}>
        <span className="voice-debug-title">Voice Debug</span>
        <div className="voice-debug-controls">
          <button type="button" onClick={onClear} title="Clear log">
            C
          </button>
          <button
            type="button"
            onClick={() => setMinimized(!minimized)}
            title={minimized ? "Expand" : "Minimize"}
          >
            {minimized ? "+" : "-"}
          </button>
        </div>
      </div>
      {!minimized && (
        <>
          <div className="voice-debug-tabs">
            <button
              type="button"
              className={`voice-debug-tab ${activeTab === "input" ? "voice-debug-tab--active" : ""}`}
              onClick={() => setActiveTab("input")}
            >
              Input
            </button>
            <button
              type="button"
              className={`voice-debug-tab ${activeTab === "log" ? "voice-debug-tab--active" : ""}`}
              onClick={() => setActiveTab("log")}
            >
              Log{entries.length > 0 ? ` (${entries.length})` : ""}
            </button>
            <div className="voice-debug-tabs-meter">
              <div
                className="voice-debug-tabs-meter-dot"
                style={{ opacity: Math.min(audioLevel * 5, 1) }}
              />
            </div>
          </div>

          {activeTab === "log" && (
            <div className="voice-debug-body" ref={scrollRef}>
              <div className="voice-debug-meter">
                <span className="voice-debug-meter-label">MIC</span>
                <div className="voice-debug-meter-track">
                  <div
                    className="voice-debug-meter-fill"
                    style={{ width: `${Math.min(audioLevel * 100, 100)}%` }}
                  />
                </div>
                <span className="voice-debug-meter-value">{(audioLevel * 100).toFixed(0)}%</span>
              </div>
              {entries.length === 0 && (
                <div className="voice-debug-empty">No voice events yet</div>
              )}
              {entries.map((entry) => (
                <div key={entry.id} className={`debug-entry ${typeClass(entry.type)}`}>
                  <span className="debug-entry-time">{formatTime(entry.timestamp)}</span>
                  <span className="debug-entry-label">{typeLabel(entry.type)}</span>
                  <span className="debug-entry-text">{entry.text}</span>
                </div>
              ))}
              {interim && (
                <div className="debug-entry debug-entry--interim">
                  <span className="debug-entry-time">{formatTime(Date.now())}</span>
                  <span className="debug-entry-label">...</span>
                  <span className="debug-entry-text">{interim}</span>
                </div>
              )}
            </div>
          )}

          {activeTab === "input" && (
            <div className="voice-debug-input-tab">
              <textarea
                className="voice-debug-textarea"
                placeholder="Type a command to simulate voice input…&#10;&#10;Examples:&#10;  Open a browser to google.com&#10;  Open a terminal&#10;  Start a session to build a login page"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <div className="voice-debug-input-footer">
                <span className="voice-debug-input-hint">Enter to send · Shift+Enter for newline</span>
                <button
                  type="button"
                  className="voice-debug-send-btn"
                  onClick={handleSend}
                  disabled={!inputText.trim()}
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// AUDIO METER
// ============================================================================

function AudioMeter({ level }: { level: number }) {
  return (
    <div className="audio-meter">
      <div className="audio-meter-label">MIC</div>
      <div className="audio-meter-track">
        <div className="audio-meter-fill" style={{ width: `${Math.min(level * 100, 100)}%` }} />
      </div>
    </div>
  );
}
