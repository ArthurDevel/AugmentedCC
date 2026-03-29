/**
 * LLM-based voice command parser using OpenRouter.
 *
 * - Receives a final transcript string
 * - Sends it to OpenRouter with a system prompt defining available tools
 * - Returns a structured ToolCall or null if the transcript is not a command
 */

import type { ToolCall, ToolName } from "./types";
import { TOOL_NAMES } from "./types";

// ============================================================================
// CONSTANTS
// ============================================================================

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "google/gemini-2.0-flash-001";

const SYSTEM_PROMPT = `You are a voice command parser for a developer's AR workspace.
You receive transcribed speech and determine if it is a command.

Available tools:
1. open_terminal - Opens a terminal window. Params: { "command"?: string }
   Optionally runs a command on open.
   If the user asks to open a coding session, open Claude, or start a coding agent, use this
   tool with { "command": "claude" } to launch Claude Code in the new terminal.
2. open_browser - Opens a browser window/panel with a URL. Params: { "url": string }
   The url should be a full URL including protocol (e.g. https://google.com).
3. close_window - Closes the currently focused/active window. Params: {}
4. run_command - Runs a command in the currently focused terminal. Params: { "command": string }
   The command string is typed and executed in whichever terminal is currently focused.
5. ask_claude - Sends a prompt to Claude Code running in the focused terminal. Params: { "prompt": string }
   The prompt is a natural-language instruction for Claude. Rephrase the user's speech into a
   clear, concise instruction. Do NOT include the "ask claude to" prefix — just the task itself.
6. send_key - Sends a single keyboard key to the focused terminal. Params: { "key": string }
   Valid keys: "enter", "up", "down", "left", "right", "tab", "escape", "backspace", "space",
   "y", "n", or any single character. Use this when the user wants to press a key, confirm
   something, navigate menus, or send a single character.

Examples:
- "Open a terminal" → { "tool": "open_terminal", "params": {} }
- "Open a terminal and run npm install" → { "tool": "open_terminal", "params": { "command": "npm install" } }
- "Start a coding session" → { "tool": "open_terminal", "params": { "command": "claude" } }
- "Open Claude" → { "tool": "open_terminal", "params": { "command": "claude" } }
- "Start a new coding agent" → { "tool": "open_terminal", "params": { "command": "claude" } }
- "Open google" → { "tool": "open_browser", "params": { "url": "https://google.com" } }
- "Open a browser to github.com/user/repo" → { "tool": "open_browser", "params": { "url": "https://github.com/user/repo" } }
- "Close this window" → { "tool": "close_window", "params": {} }
- "Close that" → { "tool": "close_window", "params": {} }
- "Run ls -lah" → { "tool": "run_command", "params": { "command": "ls -lah" } }
- "Run the npm install command" → { "tool": "run_command", "params": { "command": "npm install" } }
- "Execute git status" → { "tool": "run_command", "params": { "command": "git status" } }
- "Run npm run dev" → { "tool": "run_command", "params": { "command": "npm run dev" } }
- "Ask Claude to create an empty file called test_file" → { "tool": "ask_claude", "params": { "prompt": "Create an empty file called test_file" } }
- "Tell Claude to fix the login bug" → { "tool": "ask_claude", "params": { "prompt": "Fix the login bug" } }
- "Have Claude add a dark mode toggle" → { "tool": "ask_claude", "params": { "prompt": "Add a dark mode toggle" } }
- "Ask Claude to refactor the database layer" → { "tool": "ask_claude", "params": { "prompt": "Refactor the database layer" } }
- "Press enter" → { "tool": "send_key", "params": { "key": "enter" } }
- "Hit the down arrow" → { "tool": "send_key", "params": { "key": "down" } }
- "Press escape" → { "tool": "send_key", "params": { "key": "escape" } }
- "Press Y" → { "tool": "send_key", "params": { "key": "y" } }
- "Confirm" → { "tool": "send_key", "params": { "key": "y" } }
- "Go up" → { "tool": "send_key", "params": { "key": "up" } }
- "Tab" → { "tool": "send_key", "params": { "key": "tab" } }
- "Yeah that looks good" → { "tool": null, "params": null }

If the speech is a command, respond with ONLY valid JSON:
{ "tool": "<tool_name>", "params": { ... } }

If the speech is NOT a command (just conversation, noise, etc.), respond with:
{ "tool": null, "params": null }

Respond with ONLY the JSON object, nothing else.`;

// ============================================================================
// TYPES
// ============================================================================

interface OpenRouterMessage {
  role: "system" | "user";
  content: string;
}

interface OpenRouterChoice {
  message: { content: string };
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Parses a transcript into a tool call using OpenRouter LLM.
 * @param transcript - the final transcript text from Deepgram
 * @param apiKey - OpenRouter API key
 * @returns parsed ToolCall, or { tool: null, params: null } if not a command
 */
export async function parseCommand(
  transcript: string,
  apiKey: string,
): Promise<ToolCall & { raw: string }> {
  const messages: OpenRouterMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: transcript },
  ];

  console.log(`[voice] calling OpenRouter for: "${transcript}"`);
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      temperature: 0,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${body}`);
  }

  const data: OpenRouterResponse = await response.json();
  const content = data.choices[0]?.message?.content;
  console.log(`[voice] OpenRouter response: ${content}`);

  if (!content) {
    throw new Error("OpenRouter returned empty response");
  }

  return { ...parseToolCallJson(content), raw: content };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parses the raw LLM JSON response into a validated ToolCall.
 * @param raw - raw JSON string from the LLM
 * @returns validated ToolCall
 */
function parseToolCallJson(raw: string): ToolCall {
  // Strip markdown fences if the LLM wraps the JSON
  const cleaned = raw
    .replace(/```json?\s*/g, "")
    .replace(/```/g, "")
    .trim();

  const parsed = JSON.parse(cleaned);

  // Not a command
  if (parsed.tool === null) {
    return { tool: null, params: null };
  }

  // Validate tool name
  if (!TOOL_NAMES.includes(parsed.tool as ToolName)) {
    throw new Error(`Unknown tool: ${parsed.tool}`);
  }

  return {
    tool: parsed.tool as ToolName,
    params: parsed.params,
  };
}
