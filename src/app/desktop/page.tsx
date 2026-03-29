/**
 * Virtual Desktop Page
 *
 * Renders dynamic iframe panels in a flex layout. This page is loaded by
 * headless Chrome (Puppeteer) and screenshotted for the VR view.
 *
 * - Transparent background so AR passthrough shows through gaps
 * - Add/remove iframe panels via a toolbar
 * - Auto-layout: panels flex-shrink to fit as more are added
 * - Audio meter in the bottom-right corner (reads WS levels)
 */
"use client";

import { useState, useCallback, useRef } from "react";

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

interface VoiceDebugEntry {
  id: number;
  type: "transcript" | "tool_call" | "error";
  text: string;
  timestamp: number;
}

// ============================================================================
// EVENT HANDLERS / HOOKS
// ============================================================================

/**
 * Generates a unique panel ID.
 * @returns A unique string ID
 */
function generateId(): string {
  return `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * Toolbar with add/remove controls for iframe panels.
 * @param onAdd - callback to add a new panel
 * @param onRemoveLast - callback to remove the last panel
 * @param panelCount - current number of panels
 */
function Toolbar({
  onAdd,
  onRemoveLast,
  panelCount,
}: {
  onAdd: () => void;
  onRemoveLast: () => void;
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
      <span className="panel-count">{panelCount} / {MAX_PANELS}</span>
    </div>
  );
}

/**
 * A single iframe panel that renders a URL.
 * @param panel - the panel data (id and url)
 * @param onRemove - callback to remove this specific panel
 */
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

/**
 * Floating debug window showing voice transcript and tool calls.
 * Draggable via the title bar. Scrolls to bottom on new entries.
 * @param entries - array of debug log entries
 * @param onClear - callback to clear entries
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

  // Auto-scroll to bottom when new entries appear
  const prevLength = useRef(entries.length);
  if (entries.length !== prevLength.current) {
    prevLength.current = entries.length;
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 0);
  }

  /**
   * Starts dragging the window.
   * @param e - mouse down event on the title bar
   */
  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: position.x, origY: position.y };

    const handleMove = (ev: MouseEvent) => {
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

  /**
   * Formats a timestamp to HH:MM:SS.
   * @param ts - unix timestamp in ms
   * @returns formatted time string
   */
  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false });
  };

  /**
   * Returns a CSS class suffix for the entry type.
   * @param type - the entry type
   * @returns CSS class suffix
   */
  const typeClass = (type: VoiceDebugEntry["type"]): string => {
    switch (type) {
      case "transcript": return "debug-entry--transcript";
      case "tool_call": return "debug-entry--tool";
      case "error": return "debug-entry--error";
    }
  };

  /**
   * Returns a label prefix for the entry type.
   * @param type - the entry type
   * @returns label string
   */
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
          <button onClick={onClear} title="Clear">C</button>
          <button onClick={() => setMinimized(!minimized)} title={minimized ? "Expand" : "Minimize"}>
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

/**
 * Audio level meter displayed in the bottom-right corner.
 * @param level - RMS audio level between 0 and 1
 */
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

// ============================================================================
// RENDER
// ============================================================================

export default function DesktopPage() {
  const [panels, setPanels] = useState<Panel[]>([]);
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

  return (
    <div className="desktop-root">
      <Toolbar onAdd={addPanel} onRemoveLast={removeLast} panelCount={panels.length} />

      <div className="panels-container">
        {panels.length === 0 && (
          <div className="empty-state">Click &quot;+ Add Panel&quot; to open a browser tile</div>
        )}
        {panels.map((panel) => (
          <IframePanel key={panel.id} panel={panel} onRemove={removeById} />
        ))}
      </div>

      <VoiceDebugWindow entries={debugEntries} onClear={clearDebugEntries} />
      <AudioMeter level={audioLevel} />
    </div>
  );
}
