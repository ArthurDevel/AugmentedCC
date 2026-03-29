/**
 * Executes parsed voice tool calls.
 *
 * - Receives a ToolCall from the command parser
 * - Logs the execution (actual side effects will be wired later)
 * - Broadcasts the tool call event to debug consumers
 */

import {
  ToolCall,
  ToolCallEvent,
  OpenSessionParams,
  SendMessageParams,
  SetActiveSessionParams,
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
 * Executes a tool call. Currently logs the action; actual desktop
 * state mutations will be wired in when the WS bridge is built.
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
    case "open_session":
      handleOpenSession(toolCall.params as OpenSessionParams);
      break;
    case "send_message_to_session":
      handleSendMessage(toolCall.params as SendMessageParams);
      break;
    case "set_active_session":
      handleSetActiveSession(toolCall.params as SetActiveSessionParams);
      break;
  }

  config.onToolCall(event);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Handles the open_session tool call.
 * @param params - contains the URL to open
 */
function handleOpenSession(params: OpenSessionParams): void {
  // TODO: Wire to desktop state -- create a new panel with this URL
  console.log(`[tool] open_session: url=${params.url}`);
}

/**
 * Handles the send_message_to_session tool call.
 * @param params - contains sessionId and message to type
 */
function handleSendMessage(params: SendMessageParams): void {
  // TODO: Wire to desktop state -- type message into session's input box
  console.log(`[tool] send_message_to_session: session=${params.sessionId} msg="${params.message}"`);
}

/**
 * Handles the set_active_session tool call.
 * @param params - contains sessionId to focus
 */
function handleSetActiveSession(params: SetActiveSessionParams): void {
  // TODO: Wire to desktop state -- set active/focused panel
  console.log(`[tool] set_active_session: session=${params.sessionId}`);
}
