/**
 * Deepgram Flux streaming speech-to-text client.
 *
 * - Opens a persistent WebSocket to Deepgram's streaming API
 * - Accepts raw PCM audio chunks via sendAudio()
 * - Emits final transcripts via an onTranscript callback
 * - Auto-reconnects on disconnect
 */

import WebSocket from "ws";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";
const DEEPGRAM_MODEL = "nova-3";
const RECONNECT_DELAY_MS = 2000;

// ============================================================================
// TYPES
// ============================================================================

interface DeepgramConfig {
  apiKey: string;
  /** Called when a final transcript is received */
  onTranscript: (text: string, isFinal: boolean) => void;
  /** Called on errors */
  onError: (error: string) => void;
}

interface DeepgramResult {
  channel: {
    alternatives: Array<{
      transcript: string;
    }>;
  };
  is_final: boolean;
  speech_final: boolean;
}

interface DeepgramMessage {
  type: string;
  channel?: DeepgramResult["channel"];
  is_final?: boolean;
  speech_final?: boolean;
}

// ============================================================================
// MAIN CLASS
// ============================================================================

export class DeepgramClient {
  private ws: WebSocket | null = null;
  private config: DeepgramConfig;
  private shouldReconnect = true;

  constructor(config: DeepgramConfig) {
    this.config = config;
  }

  /**
   * Opens the WebSocket connection to Deepgram.
   * Configures interim + final results, punctuation, and endpointing.
   */
  connect(): void {
    const params = new URLSearchParams({
      model: DEEPGRAM_MODEL,
      punctuate: "true",
      interim_results: "true",
      endpointing: "300",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
    });

    const url = `${DEEPGRAM_WS_URL}?${params.toString()}`;

    this.ws = new WebSocket(url, {
      headers: { Authorization: `Token ${this.config.apiKey}` },
    });

    this.ws.on("open", () => {
      console.log("[deepgram] connected");
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      this.handleMessage(data);
    });

    this.ws.on("close", () => {
      console.log("[deepgram] disconnected");
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    });

    this.ws.on("error", (err: Error) => {
      this.config.onError(`Deepgram WS error: ${err.message}`);
    });
  }

  /**
   * Sends a chunk of raw PCM audio to Deepgram.
   * @param audio - Buffer of linear16 PCM audio at 16kHz mono
   */
  sendAudio(audio: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(audio);
    }
  }

  /**
   * Gracefully closes the Deepgram connection.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      // Send close frame per Deepgram protocol
      this.ws.send(JSON.stringify({ type: "CloseStream" }));
      this.ws.close();
      this.ws = null;
    }
  }

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  /**
   * Parses incoming Deepgram messages and forwards transcripts.
   * @param data - raw WebSocket message
   */
  private handleMessage(data: WebSocket.Data): void {
    const msg: DeepgramMessage = JSON.parse(data.toString());

    if (msg.type !== "Results" || !msg.channel) return;

    const transcript = msg.channel.alternatives[0]?.transcript;
    if (!transcript) return;

    const isFinal = msg.is_final === true && msg.speech_final === true;

    this.config.onTranscript(transcript, isFinal);
  }
}
