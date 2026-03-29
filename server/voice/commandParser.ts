/**
 * LLM-based voice command parser using OpenRouter.
 *
 * - Receives a final transcript string
 * - Sends it to OpenRouter with a system prompt defining available tools
 * - Returns a structured ToolCall or null if the transcript is not a command
 */

import { ToolCall, ToolName, TOOL_NAMES } from "./types";

// ============================================================================
// CONSTANTS
// ============================================================================

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "google/gemini-2.0-flash-001";

const SYSTEM_PROMPT = `You are a voice command parser for a VR desktop with multiple browser sessions.
You receive transcribed speech and determine if it is a command.

Available tools:
1. open_session - Opens a new browser session. Params: { "url": string }
2. send_message_to_session - Types a message into a session's input box. Params: { "sessionId": string, "message": string }
3. set_active_session - Switches focus to a session. Params: { "sessionId": string }

Session IDs are: session_1, session_2, session_3 (positional, left to right).
Users may refer to them as "first", "second", "third", "one", "two", "three", etc.

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
export async function parseCommand(transcript: string, apiKey: string): Promise<ToolCall> {
  const messages: OpenRouterMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: transcript },
  ];

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

  if (!content) {
    throw new Error("OpenRouter returned empty response");
  }

  return parseToolCallJson(content);
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
  const cleaned = raw.replace(/```json?\s*/g, "").replace(/```/g, "").trim();

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
