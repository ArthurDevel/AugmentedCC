/**
 * Voice pipeline shared types.
 *
 * - Tool definitions for the LLM command parser
 * - Voice event types broadcast to debug consumers
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const TOOL_NAMES = ["open_session", "send_message_to_session", "set_active_session"] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

// ============================================================================
// TOOL CALL TYPES
// ============================================================================

export interface OpenSessionParams {
  url: string;
}

export interface SendMessageParams {
  sessionId: string;
  message: string;
}

export interface SetActiveSessionParams {
  sessionId: string;
}

export type ToolParams = OpenSessionParams | SendMessageParams | SetActiveSessionParams;

/** Parsed tool call from the LLM. null tool means the transcript was not a command. */
export interface ToolCall {
  tool: ToolName | null;
  params: ToolParams | null;
}

// ============================================================================
// VOICE EVENT TYPES (broadcast to debug window)
// ============================================================================

export interface TranscriptEvent {
  type: "transcript";
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface ToolCallEvent {
  type: "tool_call";
  tool: ToolName;
  params: ToolParams;
  timestamp: number;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  timestamp: number;
}

export type VoiceEvent = TranscriptEvent | ToolCallEvent | ErrorEvent;
