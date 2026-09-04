import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

export const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

// ─── OpenAI <-> Anthropic message shapes ─────────────────────────────────────

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer";
  content: string | Array<{ type: string; text?: string }>;
}

export interface OpenAIChatRequest {
  model?: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

function flattenContent(c: OpenAIMessage["content"]): string {
  if (typeof c === "string") return c;
  return c.map((p) => p.text ?? "").join("");
}

/**
 * Split OpenAI-style messages into an Anthropic system string + message list.
 * Agora Convo AI sends the running conversation as messages[]; the first
 * system message is our composed round prompt. We also allow the proxy to have
 * injected extra system directives — we concatenate all system messages.
 */
export function toAnthropicInput(messages: OpenAIMessage[]): {
  system: string;
  messages: Anthropic.MessageParam[];
} {
  const system = messages
    .filter((m) => m.role === "system" || m.role === "developer")
    .map((m) => flattenContent(m.content))
    .join("\n\n");

  const conv: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = flattenContent(m.content).trim();
    // Anthropic rejects empty-content messages (e.g. a blank ASR result).
    if (!text) {
      if (m.role === "user") conv.push({ role: "user", content: "(no response)" });
      continue;
    }
    conv.push({ role: m.role, content: text });
  }
  // Anthropic requires the first message to be from the user.
  if (conv.length === 0 || conv[0].role !== "user") {
    conv.unshift({ role: "user", content: "(begin)" });
  }
  return { system, messages: conv };
}

// ─── OpenAI SSE encoders (what we stream back to Agora) ──────────────────────

const enc = new TextEncoder();

export function sseChunk(id: string, model: string, delta: string): Uint8Array {
  const payload = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
  };
  return enc.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export function sseDone(id: string, model: string): Uint8Array {
  const payload = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  return enc.encode(
    `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`
  );
}

export function nonStreamBody(id: string, model: string, text: string) {
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/** One-shot Claude call returning plain text (used for digests + summary). */
export async function claudeText(args: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** low | medium | high | xhigh | max — controls thinking depth / spend. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}): Promise<string> {
  // Note: sonnet-5 / opus-5 removed temperature/top_p/top_k (400 if sent).
  const res = await anthropic.messages.create({
    model: args.model,
    max_tokens: args.maxTokens ?? 1500,
    output_config: { effort: args.effort ?? "medium" },
    system: args.system,
    messages: [{ role: "user", content: args.user }],
  });
  return res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

/** Parse a JSON object out of a model response that may be fenced or chatty. */
export function extractJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in response");
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch {
    // tolerate trailing commas before } or ]
    return JSON.parse(slice.replace(/,(\s*[}\]])/g, "$1")) as T;
  }
}
