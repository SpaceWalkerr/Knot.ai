import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, ttsReadiness } from "./config.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerChatCompletions } from "./routes/chatCompletions.js";
import "./db.js"; // init schema

const app = Fastify({
  logger: { level: "info", transport: { target: "pino-pretty" } },
});

await app.register(cors, { origin: true });

app.get("/health", async () => {
  const tts = ttsReadiness();
  return {
    ok: true,
    mockAgora: config.agora.mock,
    publicBaseUrl: config.publicBaseUrl,
    hasAnthropicKey: Boolean(config.anthropic.apiKey),
    // The single fact that decides whether a live interview has a voice.
    voiceReady: config.agora.mock ? true : tts.ready,
    tts,
  };
});

/**
 * Pre-flight for the live voice loop. Agora's agent joins and reports RUNNING
 * even with no TTS credentials — it just never publishes audio, silently. Hit
 * this before a demo: if `ready` is false the interviewer WILL be mute, and
 * `missing` names the exact env vars to set. Returns 200 when ready, 503 when
 * not, so `curl -f` / a status check catches it without reading the body.
 */
app.get("/health/tts", async (_req, reply) => {
  const tts = ttsReadiness();
  const message = tts.mock
    ? "MOCK_AGORA is on — no real TTS needed."
    : tts.ready
      ? `TTS vendor "${tts.vendor}" has its credentials set. The interviewer should have a voice.`
      : `TTS vendor "${tts.vendor}" is MISSING ${tts.missing}. The agent will join and stay SILENT. Set these in Render → Environment, or switch TTS_VENDOR.`;
  return reply.code(tts.ready ? 200 : 503).send({ ...tts, message });
});

registerSessionRoutes(app);
registerChatCompletions(app);

// In production the server also serves the built web app (single origin, no CORS).
// apps/server/src/index.ts -> ../../web/dist
const webDist = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (
      req.method === "GET" &&
      !req.url.startsWith("/api") &&
      !req.url.startsWith("/v1") &&
      !req.url.startsWith("/health")
    ) {
      return reply.sendFile("index.html"); // SPA fallback
    }
    reply.code(404).send({ error: "not found" });
  });
  app.log.info(`serving web app from ${webDist}`);
}

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`Knot.ai server on :${config.port}  (mockAgora=${config.agora.mock})`);
    if (config.publicBaseUrl.includes("localhost")) {
      app.log.warn(
        "PUBLIC_BASE_URL is localhost — Agora's cloud cannot reach the proxy. Start a tunnel: npm run tunnel"
      );
    }
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
