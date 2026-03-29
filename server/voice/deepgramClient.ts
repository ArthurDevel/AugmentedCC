/**
 * Deepgram Flux streaming speech-to-text client.
 *
 * Uses @deepgram/sdk v5 listen.v2 (Flux) for turn-based transcription.
 * - Connects via SDK's listen.v2.createConnection()
 * - Accepts raw PCM audio chunks via sendAudio()
 * - Emits transcripts based on Flux turn events
 * - Auto-reconnects on disconnect
 */

import { DeepgramClient as DGClient } from "@deepgram/sdk";

// ============================================================================
// CONSTANTS
// ============================================================================

const RECONNECT_DELAY_MS = 2000;

// ============================================================================
// TYPES
// ============================================================================

interface DeepgramConfig {
  apiKey: string;
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
}

// SDK message shapes (from V2Socket.Response union)
interface FluxTurnInfo {
  type: "TurnInfo";
  event: "StartOfTurn" | "Update" | "EagerEndOfTurn" | "TurnResumed" | "EndOfTurn";
  turn_index: number;
  transcript: string;
  end_of_turn_confidence: number;
}

interface FluxConnected {
  type: "Connected";
}

interface FluxError {
  type: "Error";
  code: string;
  description: string;
}

type FluxMessage = FluxTurnInfo | FluxConnected | FluxError | { type: string };

// ============================================================================
// MAIN CLASS
// ============================================================================

export class DeepgramClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private socket: any = null;
  private dgClient: DGClient;
  private config: DeepgramConfig;
  private shouldReconnect = true;
  private connected = false;
  private connecting = false;

  constructor(config: DeepgramConfig) {
    this.config = config;
    this.dgClient = new DGClient({ apiKey: config.apiKey });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.socket || this.connecting) return;
    this.connecting = true;

    try {
      const socket = await this.dgClient.listen.v2.createConnection({
        model: "flux-general-en",
        eot_threshold: 0.7,
        eot_timeout_ms: 5000,
        encoding: "linear16",
        sample_rate: 16000,
      });

      socket.on("open", () => {
        this.connected = true;
        console.log("[deepgram] connected (Flux)");
      });

      socket.on("message", (data: FluxMessage) => {
        this.handleMessage(data);
      });

      socket.on("close", () => {
        this.connected = false;
        this.socket = null;
        console.log("[deepgram] disconnected");
        if (this.shouldReconnect) {
          setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
        }
      });

      socket.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : JSON.stringify(err);
        console.error("[deepgram] error:", msg);
        this.config.onError(`Deepgram error: ${msg}`);
      });

      // Initiate the actual WebSocket connection
      socket.connect();
      await socket.waitForOpen();

      this.socket = socket;
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error("[deepgram] connect failed:", msg);
      this.config.onError(`Deepgram connect failed: ${msg}`);
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    } finally {
      this.connecting = false;
    }
  }

  sendAudio(audio: Buffer): void {
    if (this.connected && this.socket) {
      this.socket.sendMedia(audio);
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.socket) {
      try {
        this.socket.sendCloseStream({ type: "CloseStream" });
      } catch { /* ignore */ }
      this.socket.close();
      this.socket = null;
      this.connected = false;
    }
  }

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  private handleMessage(data: FluxMessage): void {
    if (data.type === "Connected") {
      console.log("[deepgram] Flux session started");
      return;
    }

    if (data.type === "Error") {
      const err = data as FluxError;
      console.error(`[deepgram] error: ${err.code} - ${err.description}`);
      this.config.onError(`Deepgram: ${err.description}`);
      return;
    }

    if (data.type !== "TurnInfo") return;

    const turn = data as FluxTurnInfo;

    if (turn.event === "StartOfTurn") {
      console.log(`[deepgram] StartOfTurn (turn ${turn.turn_index})`);
    }

    if (turn.transcript) {
      const isFinal = turn.event === "EndOfTurn" || turn.event === "EagerEndOfTurn";
      console.log(`[deepgram] ${turn.event}: "${turn.transcript}"`);
      this.config.onTranscript(turn.transcript, isFinal);
    }

    if (turn.event === "EndOfTurn") {
      console.log(`[deepgram] EndOfTurn (turn ${turn.turn_index}, confidence=${turn.end_of_turn_confidence})`);
    }
  }
}
