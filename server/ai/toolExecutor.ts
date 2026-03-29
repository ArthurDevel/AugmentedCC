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
  OpenTerminalParams,
  OpenBrowserParams,
  RunCommandParams,
  AskClaudeParams,
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
    case "open_terminal":
      handleOpenTerminal(toolCall.params as OpenTerminalParams);
      break;
    case "open_browser":
      handleOpenBrowser(toolCall.params as OpenBrowserParams);
      break;
    case "close_window":
      console.log("[tool] close_window: closing focused window");
      break;
    case "run_command":
      handleRunCommand(toolCall.params as RunCommandParams);
      break;
    case "ask_claude":
      handleAskClaude(toolCall.params as AskClaudeParams);
      break;
  }

  config.onToolCall(event);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function handleOpenTerminal(params: OpenTerminalParams): void {
  // TODO: Wire to desktop — open a terminal panel
  console.log(`[tool] open_terminal: command="${params.command ?? "(none)"}"`);
}

function handleOpenBrowser(params: OpenBrowserParams): void {
  console.log(`[tool] open_browser: url="${params.url}"`);
}

function handleRunCommand(params: RunCommandParams): void {
  console.log(`[tool] run_command: command="${params.command}"`);
}

function handleAskClaude(params: AskClaudeParams): void {
  console.log(`[tool] ask_claude: prompt="${params.prompt}"`);
}
