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
 * So check at boot and say it loudly, because nothing downstream will.
 */
if (!config.agora.mock) {
  const t = config.tts;
  const missing =
    t.vendor === "minimax"
      ? !t.minimaxApiKey || !t.minimaxGroupId
        ? "MINIMAX_GROUP_ID + MINIMAX_API_KEY"
        : ""
      : t.vendor === "elevenlabs"
        ? !t.elevenLabsKey
          ? "ELEVENLABS_API_KEY"
          : ""
        : t.vendor === "microsoft"
          ? !t.azureKey || !t.azureRegion
            ? "AZURE_TTS_KEY + AZURE_TTS_REGION"
            : ""
          : "";
  if (missing) {
    console.warn(
      `[config] ⚠️  TTS vendor "${t.vendor}" has no credentials set (${missing}).\n` +
        `[config]     The Agora agent will join the channel and stay completely silent.\n` +
        `[config]     Agora does not report this as an error — set the keys or switch TTS_VENDOR.`
    );
  }
}
