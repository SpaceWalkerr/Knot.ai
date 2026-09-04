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
  publicBaseUrl: req("PUBLIC_BASE_URL", "http://localhost:8787"),

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
