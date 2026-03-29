/**
 * AI tool call types.
 *
 * - Tool definitions for the LLM command parser
 * - Shared types used by the command parser and tool executor
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const TOOL_NAMES = ["open_terminal", "open_browser", "close_window", "run_command", "ask_claude", "send_key"] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

// ============================================================================
// TOOL CALL TYPES
// ============================================================================

export interface OpenTerminalParams {
  command?: string;
}

export interface OpenBrowserParams {
  url: string;
}

export interface CloseWindowParams {
  // no params — always acts on the focused window
}

export interface RunCommandParams {
  command: string;
}

export interface AskClaudeParams {
  prompt: string;
}

export interface SendKeyParams {
  key: string;
}

export type ToolParams = OpenTerminalParams | OpenBrowserParams | CloseWindowParams | RunCommandParams | AskClaudeParams | SendKeyParams;

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
