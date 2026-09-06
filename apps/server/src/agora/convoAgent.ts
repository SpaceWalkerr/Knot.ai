import { request } from "undici";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { buildRtcToken } from "./token.js";

/**
 * Thin client for Agora Conversational AI Engine (v2).
 *
 * ⚠️ Verify these exact field names against the current docs when you get access:
 *   https://docs.agora.io/en/conversational-ai/rest-api/join
 * The SHAPE here (join -> agent_id, leave by agent_id, VAD/turn-detection block,
 * BYO OpenAI-compatible llm.url) is what the architecture depends on.
 *
 * Set MOCK_AGORA=true to run the whole app without touching Agora.
 */

const BASE = "https://api.agora.io/api/conversational-ai-agent/v2/projects";

function authHeader(): string {
  const raw = `${config.agora.restCustomerId}:${config.agora.restCustomerSecret}`;
  return "Basic " + Buffer.from(raw).toString("base64");
}

export interface StartAgentArgs {
  sessionId: string;
  channel: string;
  systemPrompt: string;
  greeting: string;
  /** vendor-agnostic hint from the persona; mapped to a concrete voice below. */
  voiceHint: string;
}

export interface RunningAgent {
  agentId: string;
  channel: string;
  mock: boolean;
  /** what we sent Agora for TTS + the raw join response — for /debug. */
  diag?: { ttsBlock: unknown; joinStatus: number; joinResponse: string };
}

// --- Turn detection / interruption. Explicit on purpose (do NOT rely on defaults). ---
// Tune these live in the first test session.
const VAD = {
  threshold: 0.5, //   speech-probability gate (0..1). Lower = more sensitive.
  prefix_padding_ms: 300, //   audio kept before detected speech start
  silence_duration_ms: 640, //   trailing silence that ends the candidate's turn
  interrupt_duration_ms: 160, //   candidate speech this long cuts off the agent (barge-in)
};

function ttsParams(voiceHint: string) {
  if (config.tts.vendor === "minimax") {
    // Exact shape of the working no-code console agent (confirmed by Agora
    // support). The project's MiniMax is a MANAGED RESELLER resource: reference
    // it by `resource_id`; do NOT send group_id / key / api key — the credential
    // is not exposed. Keep params minimal — matching the known-good block.
    const params: Record<string, unknown> = {
      model: config.tts.minimaxModel, // "speech-2.8-turbo"
      voice_setting: {
        // Per-persona voice, falling back to the single confirmed voice.
        // NB only English_radiant_girl is confirmed working on this project.
        voice_id: config.tts.minimaxVoices[voiceHint] || config.tts.minimaxVoice,
      },
    };
    if (config.tts.minimaxResourceId) {
      params.resource_id = config.tts.minimaxResourceId;
    } else if (config.tts.minimaxGroupId && config.tts.minimaxApiKey) {
      // fallback: a company-owned MiniMax credential instead of the managed one
      params.group_id = config.tts.minimaxGroupId;
      params.key = config.tts.minimaxApiKey;
    }
    return { vendor: "minimax", params };
  }
  if (config.tts.vendor === "elevenlabs") {
    return {
      vendor: "elevenlabs",
      params: {
        key: config.tts.elevenLabsKey,
        voice_id: config.tts.elevenLabsVoiceId,
        model_id: "eleven_turbo_v2_5",
      },
    };
  }
  if (config.tts.vendor === "microsoft") {
    return {
      vendor: "microsoft",
      params: {
        key: config.tts.azureKey,
        region: config.tts.azureRegion,
        voice_name: voiceHint.includes("female")
          ? "en-US-JennyNeural"
          : "en-US-GuyNeural",
      },
    };
  }
  return { vendor: "openai", params: { voice: "alloy" } };
}

export async function startAgent(args: StartAgentArgs): Promise<RunningAgent> {
  if (config.agora.mock) {
    console.log(`[convoAgent:MOCK] start on ${args.channel}`);
    return { agentId: `mock-${nanoid(8)}`, channel: args.channel, mock: true };
  }

  const body = {
    name: `knot-${args.channel}-${nanoid(6)}`,
    properties: {
      channel: args.channel,
      token: buildRtcToken(args.channel, config.agora.agentUid),
      agent_rtc_uid: String(config.agora.agentUid),
      remote_rtc_uids: ["*"],
      enable_string_uid: false,
      idle_timeout: 30,
      advanced_features: {
        enable_aivad: true, // Agora's AI VAD — better turn-taking than plain VAD
        enable_bhvs: true, // background-noise / human-voice suppression
      },
      asr: { language: "en-US" },
      llm: {
        // session id in the query string is how the proxy knows which
        // interview this turn belongs to (Agora doesn't pass channel to the LLM).
        url: `${config.publicBaseUrl}/v1/chat/completions?session=${encodeURIComponent(
          args.sessionId
        )}`,
        api_key: config.proxySharedSecret,
        system_messages: [
          {
            role: "system",
            content: `${args.systemPrompt}\n\n[session:${args.sessionId}]`,
          },
        ],
        greeting_message: args.greeting,
        params: { model: "knot-interviewer", max_tokens: 1024, temperature: 0.4 },
        max_history: 32,
        input_modalities: ["text"],
        output_modalities: ["text"],
      },
      tts: ttsParams(args.voiceHint),
      vad: VAD,
    },
  };

  // Always log what we send Agora for TTS + the raw response — TTS failures are
  // silent, so this is the only place to see what actually happened.
  console.log(
    `[convoAgent] join ${args.channel} tts=${JSON.stringify(body.properties.tts)}`
  );

  const res = await request(
    `${BASE}/${config.agora.appId}/join`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify(body),
    }
  );

  const text = await res.body.text();
  console.log(`[convoAgent] join response ${res.statusCode}: ${text}`);
  if (res.statusCode >= 300) {
    throw new Error(`Agora join failed ${res.statusCode}: ${text}`);
  }
  const json = JSON.parse(text) as { agent_id?: string; agentId?: string };
  const agentId = json.agent_id ?? json.agentId;
  if (!agentId) throw new Error(`Agora join: no agent_id in ${text}`);
  console.log(`[convoAgent] agent ${agentId} started on ${args.channel}`);
  return {
    agentId,
    channel: args.channel,
    mock: false,
    diag: { ttsBlock: body.properties.tts, joinStatus: res.statusCode, joinResponse: text },
  };
}

/** Poll Agora for an agent's live status (undocumented but real). */
export async function getAgentStatus(agentId: string): Promise<unknown> {
  if (config.agora.mock || agentId.startsWith("mock-")) return { status: "MOCK" };
  const res = await request(
    `${BASE}/${config.agora.appId}/agents/${agentId}`,
    { method: "GET", headers: { Authorization: authHeader() } }
  );
  const text = await res.body.text();
  try {
    return { httpStatus: res.statusCode, ...JSON.parse(text) };
  } catch {
    return { httpStatus: res.statusCode, raw: text };
  }
}

export async function stopAgent(agentId: string): Promise<void> {
  if (config.agora.mock || agentId.startsWith("mock-")) {
    console.log(`[convoAgent:MOCK] stop ${agentId}`);
    return;
  }
  const res = await request(
    `${BASE}/${config.agora.appId}/agents/${agentId}/leave`,
    {
      method: "POST",
      headers: { Authorization: authHeader() },
    }
  );
  if (res.statusCode >= 300) {
    const text = await res.body.text();
    console.warn(`[convoAgent] stop ${agentId} -> ${res.statusCode}: ${text}`);
  }
}
