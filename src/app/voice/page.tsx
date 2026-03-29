/**
 * Voice Test Page
 *
 * Simple mic-to-transcription test page. Captures browser mic audio,
 * streams it to /ws/audio as a producer, and displays voice events
 * (transcripts, tool calls, errors) from /ws/voice.
 */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ============================================================================
// TYPES
// ============================================================================

interface VoiceEvent {
  type: "transcript" | "tool_call" | "llm_response" | "error";
  text?: string;
  isFinal?: boolean;
  tool?: string;
  params?: Record<string, unknown>;
  raw?: string;
  message?: string;
  timestamp: number;
}

interface LogEntry {
  id: number;
  type: VoiceEvent["type"];
  text: string;
  timestamp: number;
}

// ============================================================================
// HELPERS
// ============================================================================

function getWsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function VoiceTestPage() {
  const [listening, setListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [interim, setInterim] = useState("");
  const nextId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioWsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Auto-scroll on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Connect to /ws/voice for transcripts + tool calls
  useEffect(() => {
    const url = getWsUrl("/ws/voice");
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      ws = new WebSocket(url);

      ws.onmessage = (ev) => {
        try {
          const event: VoiceEvent = JSON.parse(ev.data);
          let text = "";

          if (event.type === "transcript") {
            if (!event.isFinal) {
              // Show interim text as live updating line
              setInterim(event.text ?? "");
              return;
            }
            // Final transcript — clear interim and add to log
            setInterim("");
            text = event.text ?? "";
          } else if (event.type === "tool_call") {
            text = `${event.tool}(${JSON.stringify(event.params)})`;
          } else if (event.type === "llm_response") {
            text = event.raw ?? "";
          } else if (event.type === "error") {
            text = event.message ?? "Unknown error";
          } else {
            return;
          }

          setLogs((prev) => [...prev, {
            id: nextId.current++,
            type: event.type,
            text,
            timestamp: event.timestamp ?? Date.now(),
          }]);
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        ws = null;
        if (!disposed) reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    }

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  // Connect to /ws/audio as consumer for level meter
  useEffect(() => {
    const url = getWsUrl("/ws/audio?role=consumer");
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
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        ws = null;
        if (!disposed) reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    }

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const startListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioWs = new WebSocket(getWsUrl("/ws/audio?role=producer"));
      audioWsRef.current = audioWs;

      audioWs.onopen = () => {
        const recorder = new MediaRecorder(stream, {
          mimeType: "audio/webm;codecs=opus",
          audioBitsPerSecond: 64000,
        });
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0 && audioWs.readyState === WebSocket.OPEN) {
            ev.data.arrayBuffer().then((buf) => audioWs.send(buf));
          }
        };

        recorder.start(100); // 100ms chunks
        setListening(true);
      };

      audioWs.onerror = () => audioWs.close();
      audioWs.onclose = () => stopListening();
    } catch (err) {
      console.error("Mic access failed:", err);
    }
  }, []);

  const stopListening = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    audioWsRef.current?.close();
    audioWsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setListening(false);
    setAudioLevel(0);
  }, []);

  const levelPct = Math.min(audioLevel * 300, 100); // amplify for visibility

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Voice Pipeline Test</h1>
        <p style={styles.subtitle}>
          Captures mic audio, sends to Deepgram STT, parses commands via OpenRouter.
        </p>

        {/* Controls */}
        <div style={styles.controls}>
          <button
            onClick={listening ? stopListening : startListening}
            style={{
              ...styles.button,
              background: listening ? "#ef4444" : "#22c55e",
            }}
          >
            {listening ? "Stop" : "Start"} Listening
          </button>
          <button onClick={() => setLogs([])} style={styles.clearButton}>
            Clear Log
          </button>
        </div>

        {/* Level meter */}
        <div style={styles.meter}>
          <span style={styles.meterLabel}>MIC</span>
          <div style={styles.meterTrack}>
            <div
              style={{
                ...styles.meterFill,
                width: `${levelPct}%`,
                background: listening ? "#22c55e" : "#555",
              }}
            />
          </div>
          <span style={styles.meterValue}>{levelPct.toFixed(0)}%</span>
        </div>

        {/* Log entries */}
        <div ref={scrollRef} style={styles.log}>
          {logs.length === 0 && (
            <div style={styles.empty}>
              {listening ? "Listening... speak a command" : "Click Start to begin"}
            </div>
          )}
          {logs.map((entry) => (
            <div key={entry.id} style={styles.entry}>
              <span style={styles.time}>{formatTime(entry.timestamp)}</span>
              <span style={{
                ...styles.label,
                color: entry.type === "transcript" ? "#60a5fa"
                     : entry.type === "tool_call" ? "#4ade80"
                     : entry.type === "llm_response" ? "#c084fc"
                     : "#f87171",
              }}>
                {entry.type === "transcript" ? "STT"
                  : entry.type === "tool_call" ? "CMD"
                  : entry.type === "llm_response" ? "LLM"
                  : "ERR"}
              </span>
              <span style={styles.text}>{entry.text}</span>
            </div>
          ))}
          {interim && (
            <div style={styles.entry}>
              <span style={styles.time}>{formatTime(Date.now())}</span>
              <span style={{ ...styles.label, color: "#555" }}>...</span>
              <span style={{ color: "#888", fontStyle: "italic" }}>{interim}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#0a0a0a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#e5e5e5",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 600,
    background: "#1a1a1a",
    borderRadius: 12,
    border: "1px solid #333",
    padding: 24,
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 600,
  },
  subtitle: {
    margin: "8px 0 20px",
    fontSize: 14,
    color: "#888",
  },
  controls: {
    display: "flex",
    gap: 10,
    marginBottom: 16,
  },
  button: {
    padding: "10px 20px",
    border: "none",
    borderRadius: 8,
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  clearButton: {
    padding: "10px 20px",
    border: "1px solid #444",
    borderRadius: 8,
    background: "transparent",
    color: "#888",
    fontSize: 14,
    cursor: "pointer",
  },
  meter: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  meterLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#888",
    width: 30,
  },
  meterTrack: {
    flex: 1,
    height: 8,
    background: "#333",
    borderRadius: 4,
    overflow: "hidden",
  },
  meterFill: {
    height: "100%",
    borderRadius: 4,
    transition: "width 0.1s",
  },
  meterValue: {
    fontSize: 11,
    color: "#888",
    width: 35,
    textAlign: "right" as const,
  },
  log: {
    height: 350,
    overflowY: "auto" as const,
    background: "#111",
    borderRadius: 8,
    padding: 12,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: 13,
  },
  empty: {
    color: "#555",
    textAlign: "center" as const,
    paddingTop: 60,
  },
  entry: {
    display: "flex",
    gap: 8,
    padding: "4px 0",
    borderBottom: "1px solid #1a1a1a",
  },
  time: {
    color: "#555",
    flexShrink: 0,
  },
  label: {
    fontWeight: 700,
    flexShrink: 0,
    width: 32,
  },
  text: {
    color: "#e5e5e5",
    wordBreak: "break-word" as const,
  },
};
