import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerChatCompletions } from "./routes/chatCompletions.js";
import "./db.js"; // init schema

const app = Fastify({
  logger: { level: "info", transport: { target: "pino-pretty" } },
});

await app.register(cors, { origin: true });

app.get("/health", async () => ({
  ok: true,
  mockAgora: config.agora.mock,
  publicBaseUrl: config.publicBaseUrl,
  hasAnthropicKey: Boolean(config.anthropic.apiKey),
}));

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
