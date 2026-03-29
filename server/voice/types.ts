/**
 * Voice pipeline event types broadcast to debug consumers.
 */

import type { ToolCallEvent } from "../ai/types";

export type { ToolCallEvent };

// ============================================================================
// VOICE EVENT TYPES (broadcast to debug window)
// ============================================================================

export interface TranscriptEvent {
  type: "transcript";
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface LlmResponseEvent {
  type: "llm_response";
  raw: string;
  timestamp: number;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  timestamp: number;
}

export type VoiceEvent = TranscriptEvent | ToolCallEvent | LlmResponseEvent | ErrorEvent;
