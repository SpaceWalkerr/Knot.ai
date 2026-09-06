import { request } from "undici";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { buildRtcToken, buildRtcTokenStringUid } from "./token.js";

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

// --- Turn detection / interruption. Runtime-tunable via POST /api/config/vad
// (no redeploy) so it can be dialled in with a mic; the winning values then get
// baked back in as these defaults. ---
export const VAD: Record<string, number> = {
  threshold: Number(process.env.VAD_THRESHOLD ?? 0.5), //   speech-probability gate (0..1). Higher = less twitchy.
  prefix_padding_ms: Number(process.env.VAD_PREFIX_PADDING_MS ?? 300), //   audio kept before detected speech start
  silence_duration_ms: Number(process.env.VAD_SILENCE_MS ?? 640), //   trailing silence that ends the candidate's turn
  interrupt_duration_ms: Number(process.env.VAD_INTERRUPT_MS ?? 160), //   candidate speech this long cuts the agent off (barge-in)
  enable_aivad: Number(process.env.VAD_ENABLE_AIVAD ?? 1), //   1 = Agora AI VAD on, 0 = plain energy VAD (tuning only)
};

function ttsParams(voiceHint: string) {
  if (config.tts.vendor === "minimax") {
    // Agora-managed MiniMax. credential_mode:"managed" is REQUIRED — without it
    // Agora can't resolve the managed key and the TTS stage silently fails to
    // authenticate (agent joins, status RUNNING, publishes no audio).
    const params: Record<string, unknown> = {
      url: config.tts.minimaxUrl, // required even with credential_mode:"managed"
      model: config.tts.minimaxModel, // "speech-2.8-turbo"
      voice_setting: {
        voice_id: config.tts.minimaxVoices[voiceHint] || config.tts.minimaxVoice,
      },
    };
    if (config.tts.minimaxResourceId) {
      params.resource_id = config.tts.minimaxResourceId;
      return { credential_mode: "managed", vendor: "minimax", params };
    }
    // company-owned MiniMax credential instead of the managed one
    params.group_id = config.tts.minimaxGroupId;
    params.key = config.tts.minimaxApiKey;
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
  // OpenAI TTS. On a self-owned Agora project the key goes inline.
  const OPENAI_VOICES: Record<string, string> = {
    warm_male: "onyx",
    warm_female: "shimmer",
    neutral_male: "echo",
    neutral_female: "nova",
    brisk_female: "coral",
  };
  return {
    vendor: "openai",
    params: {
      api_key: config.tts.openaiKey,
      model: config.tts.openaiModel,
      voice: OPENAI_VOICES[voiceHint] || config.tts.openaiVoice,
    },
  };
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
        enable_aivad: VAD.enable_aivad === 1, // Agora's AI VAD (runtime-tunable)
        enable_bhvs: true, // background-noise / human-voice suppression
      },
      // Agora-managed Deepgram ASR. credential_mode:"managed" is required.
      asr: {
        credential_mode: "managed",
        vendor: config.agora.asrVendor,
        params: {
          url: config.agora.asrUrl,
          model: config.agora.asrModel,
          language: config.agora.asrLanguage,
        },
      },
      llm: {
        // BYO: Agora calls OUR proxy so we can steer each turn. Session id in the
        // query string tells the proxy which interview this is.
        url: `${config.publicBaseUrl}/v1/chat/completions?session=${encodeURIComponent(
          args.sessionId
        )}`,
        api_key: config.proxySharedSecret,
        style: "openai",
        system_messages: [
          {
            role: "system",
            content: `${args.systemPrompt}\n\n[session:${args.sessionId}]`,
          },
        ],
        greeting_message: args.greeting,
        failure_message: "One moment.",
        params: { model: "knot-interviewer", max_tokens: 1024 },
        max_history: 32,
      },
      tts: ttsParams(args.voiceHint),
      vad: {
        threshold: VAD.threshold,
        prefix_padding_ms: VAD.prefix_padding_ms,
        silence_duration_ms: VAD.silence_duration_ms,
        interrupt_duration_ms: VAD.interrupt_duration_ms,
      },
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

/**
 * DIAGNOSTIC: byte-for-byte the console's working "Code" tab body — managed
 * Deepgram ASR + managed OpenAI LLM + managed MiniMax TTS, all by resource_id.
 * If THIS speaks, the console config works over REST and the only question is
 * swapping the LLM for our proxy. If it stays silent, it's RTC/token/channel.
 */
export async function startAgentMinimal(args: {
  channel: string;
  greeting: string;
}): Promise<{ agentId: string; joinStatus: number; joinResponse: string }> {
  const AGENT_ACCOUNT = "knot_agent";
  const body = {
    name: args.channel,
    properties: {
      channel: args.channel,
      token: buildRtcTokenStringUid(args.channel, AGENT_ACCOUNT),
      agent_rtc_uid: AGENT_ACCOUNT,
      remote_rtc_uids: ["*"],
      enable_string_uid: true,
      idle_timeout: 30,
      asr: {
        credential_mode: "managed",
        vendor: config.agora.asrVendor,
        params: {
          url: config.agora.asrUrl,
          model: config.agora.asrModel,
          language: config.agora.asrLanguage,
        },
      },
      llm: {
        credential_mode: "managed",
        vendor: "openai",
        style: "openai",
        url: config.agora.llmOpenaiUrl,
        params: { model: "gpt-4.1-mini" },
        system_messages: [
          { role: "system", content: "You are a test agent. Reply in one short sentence." },
        ],
        greeting_message: args.greeting,
        failure_message: "One moment.",
        max_history: 10,
      },
      tts: ttsParams("neutral_female"),
    },
  };
  console.log(`[diag] minimal join ${args.channel} body=${JSON.stringify(body.properties)}`);
  const res = await request(`${BASE}/${config.agora.appId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: JSON.stringify(body),
  });
  const text = await res.body.text();
  console.log(`[diag] minimal join response ${res.statusCode}: ${text}`);
  const json = JSON.parse(text) as { agent_id?: string };
  return {
    agentId: json.agent_id ?? "",
    joinStatus: res.statusCode,
    joinResponse: text,
  };
}

/** DIAGNOSTIC: force the agent to speak a line via Agora's undocumented /speak. */
export async function agentSpeak(agentId: string, text: string): Promise<unknown> {
  const res = await request(
    `${BASE}/${config.agora.appId}/agents/${agentId}/speak`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader() },
      body: JSON.stringify({ text, priority: "INTERRUPT", interruptable: true }),
    }
  );
  const body = await res.body.text();
  return { httpStatus: res.statusCode, body };
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
