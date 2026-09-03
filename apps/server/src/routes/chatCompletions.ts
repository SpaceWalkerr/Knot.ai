import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import {
  nonStreamBody,
  sseChunk,
  sseDone,
  type OpenAIChatRequest,
  type OpenAIMessage,
} from "../llm/anthropic.js";
import { runProxyTurn } from "../interview/engine.js";
import { normalizeForTts } from "../interview/ttsNormalize.js";

/**
 * OpenAI-compatible endpoint that Agora's Conversational AI Engine calls once
 * per turn. This is where persona prompt, difficulty steering, follow-up
 * forcing, transcript logging, and TTS normalisation all happen.
 *
 * Agora config points llm.url here with `?session=<id>` and sends
 * llm.api_key as `Authorization: Bearer <PROXY_SHARED_SECRET>`.
 */
export function registerChatCompletions(app: FastifyInstance): void {
  app.post("/v1/chat/completions", async (req, reply) => {
    // --- auth ---
    const auth = req.headers.authorization ?? "";
    const presented = auth.replace(/^Bearer\s+/i, "").trim();
    if (presented !== config.proxySharedSecret) {
      return reply.code(401).send({ error: "bad proxy secret" });
    }

    const body = req.body as OpenAIChatRequest;
    const messages: OpenAIMessage[] = body?.messages ?? [];

    // --- resolve session id (query string first, then [session:...] marker) ---
    const q = (req.query as Record<string, string | undefined>) ?? {};
    let sessionId: string | undefined = q.session;
    if (!sessionId) {
      const sys = messages
        .filter((m) => m.role === "system")
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .join(" ");
      sessionId = sys.match(/\[session:([^\]]+)\]/)?.[1];
    }
    if (!sessionId) {
      return reply.code(400).send({ error: "no session id on proxy call" });
    }

    const id = `chatcmpl-${nanoid(12)}`;
    const model = "knot-interviewer";
    const wantsStream = body.stream !== false;

    try {
      if (!wantsStream) {
        const result = await runProxyTurn(sessionId, messages);
        return reply
          .code(200)
          .send(nonStreamBody(id, model, normalizeForTts(result.reply)));
      }

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      await runProxyTurn(sessionId, messages, (delta) => {
        reply.raw.write(sseChunk(id, model, delta));
      });

      reply.raw.write(sseDone(id, model));
      reply.raw.end();
    } catch (err) {
      req.log.error({ err }, "proxy turn failed");
      if (!reply.raw.headersSent) {
        return reply.code(500).send({ error: String(err) });
      }
      // mid-stream failure: close gracefully so TTS doesn't hang
      reply.raw.write(
        sseChunk(id, model, " Sorry, I lost my train of thought — could you repeat that?")
      );
      reply.raw.write(sseDone(id, model));
      reply.raw.end();
    }
  });
}
