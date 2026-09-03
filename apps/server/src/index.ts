import Fastify from "fastify";
import cors from "@fastify/cors";
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
