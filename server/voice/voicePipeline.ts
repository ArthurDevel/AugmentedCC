/**
 * Voice pipeline orchestrator.
 *
 * - Wires together Deepgram STT, OpenRouter command parsing, and tool execution
 * - Manages the lifecycle of the voice pipeline
 * - Broadcasts VoiceEvents to any registered listeners (e.g. debug window via WS)
 */

import { DeepgramClient } from "./deepgramClient";
import { parseCommand } from "./commandParser";
import { executeTool } from "./toolExecutor";
import { VoiceEvent, TranscriptEvent, ToolCallEvent } from "./types";

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
   * Starts the voice pipeline by connecting to Deepgram.
   */
  start(): void {
    console.log("[voice] starting pipeline");
    this.deepgram.connect();
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
   * @param audio - Buffer of linear16 PCM audio at 16kHz mono
   */
  sendAudio(audio: Buffer): void {
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
      const toolCall = await parseCommand(text, this.openRouterApiKey);

      if (toolCall.tool !== null) {
        console.log(`[voice] parsed command: ${toolCall.tool}`);
        executeTool(toolCall, {
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
