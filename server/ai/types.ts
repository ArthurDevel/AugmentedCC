/**
 * AI tool call types.
 *
 * - Tool definitions for the LLM command parser
 * - Shared types used by the command parser and tool executor
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const TOOL_NAMES = ["start_new_coding_session", "open_terminal"] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

// ============================================================================
// TOOL CALL TYPES
// ============================================================================

export interface StartNewCodingSessionParams {
  task: string;
}

export interface OpenTerminalParams {
  command?: string;
}

export type ToolParams = StartNewCodingSessionParams | OpenTerminalParams;

/** Parsed tool call from the LLM. null tool means the transcript was not a command. */
export interface ToolCall {
  tool: ToolName | null;
  params: ToolParams | null;
}

export interface ToolCallEvent {
  type: "tool_call";
  tool: ToolName;
  params: ToolParams;
  timestamp: number;
}
