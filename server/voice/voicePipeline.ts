/**
 * Voice pipeline orchestrator.
 *
 * - Wires together Deepgram STT, OpenRouter command parsing, and tool execution
 * - Manages the lifecycle of the voice pipeline
 * - Broadcasts VoiceEvents to any registered listeners (e.g. debug window via WS)
 */

import { DeepgramClient } from "./deepgramClient";
import { parseCommand } from "../ai/commandParser";
import { executeTool } from "../ai/toolExecutor";
import type { VoiceEvent, TranscriptEvent, ToolCallEvent, LlmResponseEvent } from "./types";

// ============================================================================
// TYPES
// ============================================================================

interface PipelineConfig {
  deepgramApiKey: string;
  openRouterApiKey: string;
}

type EventListener = (event: VoiceEvent) => void;

// ============================================================================
// MAIN CLASS
// ============================================================================

export class VoicePipeline {
  private deepgram: DeepgramClient;
  private openRouterApiKey: string;
  private listeners: Set<EventListener> = new Set();

  constructor(config: PipelineConfig) {
    this.openRouterApiKey = config.openRouterApiKey;

    this.deepgram = new DeepgramClient({
      apiKey: config.deepgramApiKey,
      onTranscript: (text, isFinal) => this.handleTranscript(text, isFinal),
      onError: (message) => this.broadcast({ type: "error", message, timestamp: Date.now() }),
    });
  }

  /**
   * Starts the voice pipeline. Deepgram connection is deferred until
   * the first audio chunk arrives to avoid idle timeouts.
   */
  start(): void {
    console.log("[voice] pipeline ready (Deepgram connects on first audio)");
  }

  /**
   * Stops the voice pipeline and disconnects from Deepgram.
   */
  stop(): void {
    console.log("[voice] stopping pipeline");
    this.deepgram.disconnect();
  }

  /**
   * Feeds raw PCM audio into the pipeline.
   * Lazily connects to Deepgram on the first call.
   * @param audio - Buffer of linear16 PCM audio at 16kHz mono
   */
  sendAudio(audio: Buffer): void {
    if (!this.deepgram.isConnected()) {
      // Fire-and-forget — audio before connection opens is dropped,
      // which is fine since it's just the first ~1s of silence/noise.
      this.deepgram.connect().catch((err) => {
        console.error("[voice] Deepgram connect error:", err);
      });
      return;
    }
    this.deepgram.sendAudio(audio);
  }

  /**
   * Registers a listener that receives all VoiceEvents.
   * @param listener - callback function
   * @returns unsubscribe function
   */
  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  /**
   * Handles a transcript from Deepgram. Broadcasts it, and if final,
   * sends it to the LLM for command parsing.
   * @param text - transcript text
   * @param isFinal - whether this is a final (not interim) result
   */
  private async handleTranscript(text: string, isFinal: boolean): Promise<void> {
    const transcriptEvent: TranscriptEvent = {
      type: "transcript",
      text,
      isFinal,
      timestamp: Date.now(),
    };
    this.broadcast(transcriptEvent);

    // Only parse final transcripts for commands
    if (!isFinal) return;

    console.log(`[voice] final transcript: "${text}"`);

    try {
      const result = await parseCommand(text, this.openRouterApiKey);

      const llmEvent: LlmResponseEvent = {
        type: "llm_response",
        raw: result.raw,
        timestamp: Date.now(),
      };
      this.broadcast(llmEvent);

      if (result.tool !== null) {
        console.log(`[voice] parsed command: ${result.tool}`);
        executeTool(result, {
          onToolCall: (event: ToolCallEvent) => this.broadcast(event),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[voice] parse error: ${message}`);
      this.broadcast({ type: "error", message, timestamp: Date.now() });
    }
  }

  /**
   * Sends a VoiceEvent to all registered listeners.
   * @param event - the voice event to broadcast
   */
  private broadcast(event: VoiceEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
