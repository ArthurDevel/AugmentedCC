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

import { useState, useCallback } from "react";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_URL = "https://google.com";
const MAX_PANELS = 6;
const PANEL_MAX_WIDTH = 1400;

// ============================================================================
// TYPES
// ============================================================================

interface Panel {
  id: string;
  url: string;
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

      <AudioMeter level={audioLevel} />
    </div>
  );
}
