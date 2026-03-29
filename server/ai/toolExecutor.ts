/**
 * Executes parsed tool calls.
 *
 * - Receives a ToolCall from the command parser
 * - Logs the execution (actual side effects will be wired later)
 * - Broadcasts the tool call event to debug consumers
 */

import type {
  ToolCall,
  ToolCallEvent,
  StartNewCodingSessionParams,
  OpenTerminalParams,
} from "./types";

// ============================================================================
// TYPES
// ============================================================================

interface ExecutorConfig {
  /** Called to broadcast a tool call event to debug consumers */
  onToolCall: (event: ToolCallEvent) => void;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Executes a tool call. Currently logs the action; actual side effects
 * will be wired when the integration layer is built.
 * @param toolCall - parsed tool call from the command parser
 * @param config - executor configuration with event broadcaster
 */
export function executeTool(toolCall: ToolCall, config: ExecutorConfig): void {
  if (toolCall.tool === null || toolCall.params === null) return;

  const event: ToolCallEvent = {
    type: "tool_call",
    tool: toolCall.tool,
    params: toolCall.params,
    timestamp: Date.now(),
  };

  switch (toolCall.tool) {
    case "start_new_coding_session":
      handleStartNewCodingSession(toolCall.params as StartNewCodingSessionParams);
      break;
    case "open_terminal":
      handleOpenTerminal(toolCall.params as OpenTerminalParams);
      break;
  }

  config.onToolCall(event);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function handleStartNewCodingSession(params: StartNewCodingSessionParams): void {
  // TODO: Wire to Conductor — spawn a new coding agent workspace
  console.log(`[tool] start_new_coding_session: task="${params.task}"`);
}

function handleOpenTerminal(params: OpenTerminalParams): void {
  // TODO: Wire to desktop — open a terminal panel
  console.log(`[tool] open_terminal: command="${params.command ?? "(none)"}"`);
}
