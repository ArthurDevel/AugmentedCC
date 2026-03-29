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

import { useState, useCallback, useRef, useEffect } from "react";
import type { MouseEvent } from "react";
import "@xterm/xterm/css/xterm.css";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_URL = "https://google.com";
const MAX_PANELS = 6;
const PANEL_MAX_WIDTH = 1400;
const DEBUG_WINDOW_WIDTH = 340;
const DEBUG_WINDOW_HEIGHT = 400;

// ============================================================================
// TYPES
// ============================================================================

interface Panel {
  id: string;
  url: string;
}

interface TerminalPaneDescriptor {
  id: string;
  terminalId: string;
}

interface VoiceDebugEntry {
  id: number;
  type: "transcript" | "tool_call" | "error";
  text: string;
  timestamp: number;
}

// ============================================================================
// HELPERS
// ============================================================================

function generateId(): string {
  return `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ============================================================================
// PAGE
// ============================================================================

export default function DesktopPage() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [terminalPanes, setTerminalPanes] = useState<TerminalPaneDescriptor[]>([]);
  // TODO: Wire to /ws/audio WebSocket consumer for live mic levels
  const [audioLevel] = useState(0);
  // TODO: Wire to voice pipeline WS to receive VoiceEvents
  const [debugEntries, setDebugEntries] = useState<VoiceDebugEntry[]>([]);

  const clearDebugEntries = useCallback(() => {
    setDebugEntries([]);
  }, []);

  const addPanel = useCallback(() => {
    setPanels((prev) => {
      if (prev.length >= MAX_PANELS) return prev;
      return [...prev, { id: generateId(), url: DEFAULT_URL }];
    });
  }, []);

  const removeLast = useCallback(() => {
    setPanels((prev) => prev.slice(0, -1));
  }, []);

  const removeById = useCallback((id: string) => {
    setPanels((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const addShell = useCallback(async () => {
    const res = await fetch("/api/terminals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: "shell" }),
    });
    if (!res.ok) throw new Error(`Failed to create terminal: ${res.status}`);
    const { id: terminalId } = (await res.json()) as { id: string };
    setTerminalPanes((prev) => [...prev, { id: generateId(), terminalId }]);
  }, []);

  const removeTerminal = useCallback(async (paneId: string, terminalId: string) => {
    setTerminalPanes((prev) => prev.filter((p) => p.id !== paneId));
    await fetch(`/api/terminals/${terminalId}`, { method: "DELETE" });
  }, []);

  const totalCount = panels.length + terminalPanes.length;

  return (
    <div className="desktop-root">
      <Toolbar
        onAdd={addPanel}
        onRemoveLast={removeLast}
        onAddShell={addShell}
        panelCount={panels.length}
      />

      <div className="panels-container">
        {totalCount === 0 && (
          <div className="empty-state">Click &quot;+ Add Panel&quot; or &quot;+ Shell&quot; to get started</div>
        )}
        {panels.map((panel) => (
          <IframePanel key={panel.id} panel={panel} onRemove={removeById} />
        ))}
        {terminalPanes.map((pane) => (
          <TerminalPane
            key={pane.id}
            pane={pane}
            onClose={() => removeTerminal(pane.id, pane.terminalId)}
          />
        ))}
      </div>

      <VoiceDebugWindow entries={debugEntries} onClear={clearDebugEntries} />
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
  panelCount,
}: {
  onAdd: () => void;
  onRemoveLast: () => void;
  onAddShell: () => void;
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
      <button onClick={onAddShell}>
        + Shell
      </button>
      <span className="panel-count">{panelCount} / {MAX_PANELS}</span>
    </div>
  );
}

// ============================================================================
// IFRAME PANEL
// ============================================================================

function IframePanel({
  panel,
  onRemove,
}: {
  panel: Panel;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="iframe-panel" style={{ maxWidth: PANEL_MAX_WIDTH }}>
      <div className="panel-header">
        <span className="panel-url">{panel.url}</span>
        <button className="panel-close" onClick={() => onRemove(panel.id)}>
          x
        </button>
      </div>
      <iframe src={panel.url} className="panel-iframe" title={panel.url} />
    </div>
  );
}

// ============================================================================
// TERMINAL PANE
// ============================================================================

const TerminalPane = ({
  pane,
  onClose,
}: {
  pane: TerminalPaneDescriptor;
  onClose: () => void;
}) => {
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
      // Flex layout may not have settled on first paint; refit after layout.
      requestAnimationFrame(() => {
        requestAnimationFrame(refit);
      });

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/terminal/${pane.terminalId}`,
      );

      ws.onopen = () => {
        fetch(`/api/terminals/${pane.terminalId}/resize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cols: terminal.cols, rows: terminal.rows }),
        });
      };

      ws.onmessage = (event) => {
        terminal.write(typeof event.data === "string" ? event.data : new Uint8Array(event.data as ArrayBuffer));
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
            fetch(`/api/terminals/${pane.terminalId}/resize`, {
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
  }, [pane.terminalId]);

  return (
    <div className="iframe-panel">
      <div className="panel-header">
        <span className="panel-url">Shell</span>
        <button className="panel-close" onClick={onClose}>
          x
        </button>
      </div>
      <div ref={containerRef} className="panel-terminal" />
    </div>
  );
};

// ============================================================================
// VOICE DEBUG WINDOW
// ============================================================================

/**
 * Floating debug window showing voice transcript and tool calls.
 * Draggable via the title bar. Scrolls to bottom on new entries.
 */
function VoiceDebugWindow({
  entries,
  onClear,
}: {
  entries: VoiceDebugEntry[];
  onClear: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [position, setPosition] = useState({ x: 16, y: 80 });
  const [minimized, setMinimized] = useState(false);

  const prevLength = useRef(entries.length);
  if (entries.length !== prevLength.current) {
    prevLength.current = entries.length;
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 0);
  }

  const handleDragStart = (e: MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: position.x, origY: position.y };

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

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false });
  };

  const typeClass = (type: VoiceDebugEntry["type"]): string => {
    switch (type) {
      case "transcript": return "debug-entry--transcript";
      case "tool_call": return "debug-entry--tool";
      case "error": return "debug-entry--error";
    }
  };

  const typeLabel = (type: VoiceDebugEntry["type"]): string => {
    switch (type) {
      case "transcript": return "STT";
      case "tool_call": return "CMD";
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
          <button type="button" onClick={onClear} title="Clear">C</button>
          <button type="button" onClick={() => setMinimized(!minimized)} title={minimized ? "Expand" : "Minimize"}>
            {minimized ? "+" : "-"}
          </button>
        </div>
      </div>
      {!minimized && (
        <div className="voice-debug-body" ref={scrollRef}>
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
        </div>
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
        <div
          className="audio-meter-fill"
          style={{ width: `${Math.min(level * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}
