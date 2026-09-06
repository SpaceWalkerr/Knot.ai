import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { buildRtcTokenStringUid } from "../agora/token.js";
import {
  startAgentMinimal,
  stopAgent,
  getAgentStatus,
  agentSpeak,
} from "../agora/convoAgent.js";

/**
 * Listen-only RTC diagnostic. `/api/diag/start` spins up a MINIMAL Agora agent
 * (greeting + TTS only) in a throwaway channel and hands back a subscriber
 * token. `public/diag.html` joins that channel with no microphone and reports
 * whether the agent actually publishes an audio track — the one thing HTTP 200
 * from Agora does not prove.
 */
export function registerDiagRoutes(app: FastifyInstance): void {
  app.post("/api/diag/start", async (_req, reply) => {
    if (config.agora.mock) {
      return reply.code(400).send({ error: "MOCK_AGORA is on — nothing to diagnose" });
    }
    const channel = `knotdiag-${nanoid(8)}`;
    const listenerUid = "knot_listener";
    const greeting =
      "Hello. This is the Knot dot AI diagnostic agent. If you can hear this sentence, " +
      "text to speech and audio publishing are both working.";

    let agent;
    try {
      agent = await startAgentMinimal({ channel, greeting });
    } catch (e) {
      return reply.code(502).send({ error: String(e) });
    }

    return {
      appId: config.agora.appId,
      channel,
      agentUid: config.agora.agentUid,
      listenerUid,
      stringUid: true,
      listenerToken: buildRtcTokenStringUid(channel, listenerUid),
      agentId: agent.agentId,
      joinStatus: agent.joinStatus,
      joinResponse: agent.joinResponse,
    };
  });

  app.get("/api/diag/status/:agentId", async (req) => {
    const { agentId } = req.params as { agentId: string };
    return getAgentStatus(agentId);
  });

  app.post("/api/diag/speak/:agentId", async (req) => {
    const { agentId } = req.params as { agentId: string };
    return agentSpeak(
      agentId,
      "This is a forced speak test from the Knot diagnostic. One. Two. Three."
    );
  });

  app.post("/api/diag/stop", async (req) => {
    const { agentId } = (req.body as { agentId?: string }) ?? {};
    if (agentId) await stopAgent(agentId).catch(() => {});
    return { ok: true };
  });
}
