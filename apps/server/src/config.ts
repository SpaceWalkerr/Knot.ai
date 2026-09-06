import "dotenv/config";

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    // Don't hard-crash in dev for optional-ish keys; surface loudly instead.
    console.warn(`[config] missing env ${name}`);
    return "";
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  // On Render, RENDER_EXTERNAL_URL is injected automatically and equals the
  // service's public URL — no need to hand-set PUBLIC_BASE_URL there.
  publicBaseUrl:
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "http://localhost:8787",

  anthropic: {
    apiKey: req("ANTHROPIC_API_KEY"),
    liveModel: process.env.ANTHROPIC_LIVE_MODEL ?? "claude-sonnet-5",
    summaryModel: process.env.ANTHROPIC_SUMMARY_MODEL ?? "claude-sonnet-5",
  },

  proxySharedSecret: req("PROXY_SHARED_SECRET", "change-me"),

  agora: {
    appId: req("AGORA_APP_ID"),
    appCertificate: req("AGORA_APP_CERTIFICATE"),
    restCustomerId: req("AGORA_REST_CUSTOMER_ID"),
    restCustomerSecret: req("AGORA_REST_CUSTOMER_SECRET"),
    agentUid: Number(process.env.AGORA_AGENT_UID ?? 1000),
    mock: (process.env.MOCK_AGORA ?? "true").toLowerCase() === "true",
  },

  tts: {
    vendor: (process.env.TTS_VENDOR ?? "minimax") as
      | "minimax"
      | "elevenlabs"
      | "microsoft"
      | "openai",
    minimaxVoice: process.env.MINIMAX_TTS_VOICE ?? "English_radiant_girl",
    // Agora managed-reseller MiniMax: referenced by resource_id, NOT a key. This
    // is the project's provisioned resource (confirmed via Agora support); the
    // credential itself is never exposed. speech-2.8-turbo is the console agent's
    // model. Overridable in case the project's resource changes.
    minimaxModel: process.env.MINIMAX_TTS_MODEL ?? "speech-2.8-turbo",
    minimaxResourceId:
      process.env.MINIMAX_RESOURCE_ID ?? "155b2afcadce4c93a85231c74e2e71d6",
    // Per-persona voices. A panel whose interviewers all sound identical reads
    // as one interviewer changing subject, so each persona's voiceHint maps to
    // its own MiniMax voice_id. The catalogue differs per account, so these are
    // env-driven and anything unset falls back to MINIMAX_TTS_VOICE — a missing
    // entry degrades to "same voice", it can never 400 the agent join.
    minimaxVoices: {
      warm_male: process.env.MINIMAX_VOICE_WARM_MALE ?? "",
      warm_female: process.env.MINIMAX_VOICE_WARM_FEMALE ?? "",
      neutral_male: process.env.MINIMAX_VOICE_NEUTRAL_MALE ?? "",
      neutral_female: process.env.MINIMAX_VOICE_NEUTRAL_FEMALE ?? "",
      brisk_female: process.env.MINIMAX_VOICE_BRISK_FEMALE ?? "",
    } as Record<string, string>,
    minimaxGroupId: process.env.MINIMAX_GROUP_ID ?? "",
    minimaxApiKey: process.env.MINIMAX_API_KEY ?? "",
    elevenLabsKey: process.env.ELEVENLABS_API_KEY ?? "",
    elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
    azureKey: process.env.AZURE_TTS_KEY ?? "",
    azureRegion: process.env.AZURE_TTS_REGION ?? "",
    // OpenAI TTS — key passed inline to Agora (works on a self-owned project).
    openaiKey: process.env.OPENAI_API_KEY ?? "",
    openaiModel: process.env.OPENAI_TTS_MODEL ?? "tts-1",
    openaiVoice: process.env.OPENAI_TTS_VOICE ?? "nova",
  },

  dbPath: process.env.DB_PATH ?? "./data/knot.sqlite",
};

export type Config = typeof config;

/**
 * TTS failures in Agora's Conversational AI Engine are SILENT.
 *
 * Verified live: with no MiniMax credentials the agent joins the RTC channel,
 * Agora reports status RUNNING, `/speak` returns 200 — and it never publishes
 * an audio track. Nothing anywhere says why. Only the `tts.vendor` NAME is
 * validated at join (a bogus vendor 400s; a bogus voice_id does not).
 *
 * So we check credential presence up front — at boot (below) and over HTTP via
 * /health/tts — because nothing downstream will tell you the interview is mute.
 */
export interface TtsReadiness {
  vendor: string;
  /** false = the agent will join and stay completely silent. */
  ready: boolean;
  /** the env vars that need setting, when not ready. */
  missing: string;
  /** true when MOCK_AGORA is on, so TTS creds are irrelevant. */
  mock: boolean;
}

export function ttsReadiness(): TtsReadiness {
  const t = config.tts;
  if (config.agora.mock) {
    return { vendor: t.vendor, ready: true, missing: "", mock: true };
  }
  const missing =
    t.vendor === "minimax"
      ? // a managed-reseller resource_id OR a company-owned group_id+key is enough
        !t.minimaxResourceId && !(t.minimaxApiKey && t.minimaxGroupId)
        ? "MINIMAX_RESOURCE_ID (or MINIMAX_GROUP_ID + MINIMAX_API_KEY)"
        : ""
      : t.vendor === "elevenlabs"
        ? !t.elevenLabsKey
          ? "ELEVENLABS_API_KEY"
          : ""
        : t.vendor === "microsoft"
          ? !t.azureKey || !t.azureRegion
            ? "AZURE_TTS_KEY + AZURE_TTS_REGION"
            : ""
          : t.vendor === "openai"
            ? !t.openaiKey
              ? "OPENAI_API_KEY"
              : ""
            : "";
  return { vendor: t.vendor, ready: missing === "", missing, mock: false };
}

{
  const r = ttsReadiness();
  if (!r.mock && !r.ready) {
    console.warn(
      `[config] ⚠️  TTS vendor "${r.vendor}" has no credentials set (${r.missing}).\n` +
        `[config]     The Agora agent will join the channel and stay completely silent.\n` +
        `[config]     Agora does not report this as an error — set the keys or switch TTS_VENDOR.`
    );
  }
}
