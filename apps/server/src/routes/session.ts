import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import type {
  AdvanceRoundResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  Session,
} from "@knot/shared";
import { DEFAULT_PLAN, PERSONAS, AI_DISCLOSURE_TEXT } from "@knot/shared";
import { config, ttsReadiness } from "../config.js";
import { getReport, getSession, getTurns, saveReport, saveSession } from "../db.js";
import { buildRtcToken } from "../agora/token.js";
import { getAgentStatus } from "../agora/convoAgent.js";
import { agentDiag, endRound, roundCount, startRound } from "../interview/engine.js";
import { generateGroundedReport } from "../interview/grounding.js";

export function registerSessionRoutes(app: FastifyInstance): void {
  // --- create ---
  app.post("/api/session", async (req, reply) => {
    const bodyIn = req.body as CreateSessionRequest;
    if (!bodyIn?.candidate?.name || !bodyIn?.candidate?.background) {
      return reply.code(400).send({ error: "candidate.name and .background required" });
    }
    const plan = bodyIn.plan?.length ? bodyIn.plan : DEFAULT_PLAN;
    const id = nanoid(12);
    const channel = `knot-${id}`;
    const candidateUid = Math.floor(Math.random() * 1_000_000) + 100_000;

    const session: Session = {
      id,
      status: "created",
      channel,
      context: {
        candidate: bodyIn.candidate,
        currentRound: 0,
        currentPersona: plan[0],
        currentDifficulty: 1,
        plan,
        digests: [],
      },
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
    saveSession(session);

    const res: CreateSessionResponse = {
      sessionId: id,
      channel,
      rtc: {
        appId: config.agora.appId,
        token: buildRtcToken(channel, candidateUid),
        uid: candidateUid,
      },
      plan,
      disclosureText: AI_DISCLOSURE_TEXT,
    };
    return res;
  });

  // --- candidate accepted the AI disclosure ---
  app.post("/api/session/:id/disclose", async (req, reply) => {
    const s = load(req, reply);
    if (!s) return;
    s.status = "disclosed";
    s.updatedAtMs = Date.now();
    saveSession(s);
    return { ok: true };
  });

  // --- start round 1 (spins up the Agora agent for the first persona) ---
  app.post("/api/session/:id/start", async (req, reply) => {
    const s = load(req, reply);
    if (!s) return;
    const { handoffLine, persona } = await startRound(s, 1);
    return { round: 1, persona, handoffLine };
  });

  // --- advance: end current round, digest it, start the next ---
  app.post("/api/session/:id/round/next", async (req, reply) => {
    const s = load(req, reply);
    if (!s) return;
    await endRound(s);
    const nextIndex = s.context.currentRound + 1;
    if (nextIndex > roundCount(s)) {
      const res: AdvanceRoundResponse = {
        round: s.context.currentRound,
        persona: s.context.currentPersona,
        handoffLine: "That's the last round. Generating your assessment now.",
        done: true,
      };
      return res;
    }
    const { handoffLine, persona } = await startRound(s, nextIndex);
    const res: AdvanceRoundResponse = {
      round: nextIndex,
      persona,
      handoffLine,
      done: false,
    };
    return res;
  });

  // --- end the whole session ---
  app.post("/api/session/:id/end", async (req, reply) => {
    const s = load(req, reply);
    if (!s) return;
    if (s.agentId) await endRound(s);
    s.status = "ended";
    s.updatedAtMs = Date.now();
    saveSession(s);
    return { ok: true };
  });

  // --- generate (or fetch cached) grounded report ---
  app.post("/api/session/:id/report", async (req, reply) => {
    const s = load(req, reply);
    if (!s) return;
    const report = await generateGroundedReport(s);
    saveReport(s.id, report);
    s.status = "reported";
    saveSession(s);
    return report;
  });

  app.get("/api/session/:id/report", async (req, reply) => {
    const s = load(req, reply);
    if (!s) return;
    const cached = getReport(s.id);
    if (cached) return cached;
    return reply.code(404).send({ error: "no report yet; POST to generate" });
  });

  // --- live transcript (for the UI panel; proxy log is source of truth) ---
  app.get("/api/session/:id/transcript", async (req, reply) => {
    const s = load(req, reply);
    if (!s) return;
    return {
      sessionId: s.id,
      status: s.status,
      round: s.context.currentRound,
      persona: s.context.currentPersona,
      difficulty: s.context.currentDifficulty,
      turns: getTurns(s.id),
      digests: s.context.digests,
    };
  });

  app.get("/api/session/:id", async (req, reply) => {
    const s = load(req, reply);
    if (!s) return;
    return s;
  });

  // Diagnostics for the live Agora agent: exactly what we sent for TTS, Agora's
  // raw join response, and the agent's current status. Use this to debug a
  // silent interviewer without digging through server logs.
  app.get("/api/session/:id/debug", async (req, reply) => {
    const s = load(req, reply);
    if (!s) return;
    const diag = agentDiag.get(s.id) ?? null;
    let liveStatus: unknown = null;
    if (s.agentId) {
      liveStatus = await getAgentStatus(s.agentId).catch((e) => ({
        error: String(e),
      }));
    }
    return {
      sessionId: s.id,
      status: s.status,
      agentId: s.agentId ?? null,
      channel: s.channel,
      publicBaseUrl: config.publicBaseUrl,
      tts: ttsReadiness(),
      joinDiag: diag,
      liveStatus,
    };
  });

  app.get("/api/personas", async () => PERSONAS);
}

function load(req: any, reply: any): Session | undefined {
  const id = (req.params as { id: string }).id;
  const s = getSession(id);
  if (!s) {
    reply.code(404).send({ error: `session ${id} not found` });
    return undefined;
  }
  return s;
}
