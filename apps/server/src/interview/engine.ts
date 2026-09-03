import { nanoid } from "nanoid";
import type {
  DifficultyLevel,
  PersonaId,
  Session,
  Turn,
  Verdict,
} from "@knot/shared";
import {
  PERSONAS,
  buildRoundSystemPrompt,
  buildTurnDirective,
  AI_DISCLOSURE_TEXT,
} from "@knot/shared";
import { config } from "../config.js";
import { appendTurn, getSession, getTurns, saveSession } from "../db.js";
import { startAgent, stopAgent } from "../agora/convoAgent.js";
import {
  anthropic,
  toAnthropicInput,
  type OpenAIMessage,
} from "../llm/anthropic.js";
import { assessAnswer, nextDifficulty, shouldForceFollowUp } from "./difficulty.js";
import { makeRoundDigest, collectCandidateClaims } from "./context.js";
import { normalizeForTts } from "./ttsNormalize.js";

/** Per-round runtime state. In-memory is fine for a single-node hackathon server. */
interface RoundRuntime {
  round: number;
  persona: PersonaId;
  difficulty: DifficultyLevel;
  questionsAsked: number;
  awaitingFollowUp: boolean;
}
const runtimes = new Map<string, RoundRuntime>();

function runtimeFor(session: Session): RoundRuntime {
  let r = runtimes.get(session.id);
  if (!r) {
    r = {
      round: session.context.currentRound,
      persona: session.context.currentPersona,
      difficulty: session.context.currentDifficulty,
      questionsAsked: getTurns(session.id, session.context.currentRound).filter(
        (t) => t.role === "interviewer"
      ).length,
      awaitingFollowUp: false,
    };
    runtimes.set(session.id, r);
  }
  return r;
}

// ─── round lifecycle ────────────────────────────────────────────────────────

export async function startRound(
  session: Session,
  roundIndex: number
): Promise<{ handoffLine: string; persona: PersonaId }> {
  const persona = session.context.plan[roundIndex - 1];
  const p = PERSONAS[persona];
  const isFirstRound = roundIndex === 1;
  const startingDifficulty: DifficultyLevel = 1;

  const systemPrompt = buildRoundSystemPrompt({
    persona,
    ctx: session.context,
    startingDifficulty,
    isFirstRound,
  });

  const handoffLine = isFirstRound
    ? `${AI_DISCLOSURE_TEXT}`
    : `Thanks — I'll bring in ${p.displayName} now for the next part.`;

  const greeting = isFirstRound
    ? `Hi ${session.context.candidate.name}. ${AI_DISCLOSURE_TEXT}`
    : `Hi ${session.context.candidate.name}, I'm ${p.displayName}. Let's pick up where you left off.`;

  const agent = await startAgent({
    sessionId: session.id,
    channel: session.channel,
    systemPrompt,
    greeting,
    voiceHint: p.voiceHint,
  });

  session.agentId = agent.agentId;
  session.status = "live";
  session.context.currentRound = roundIndex;
  session.context.currentPersona = persona;
  session.context.currentDifficulty = startingDifficulty;
  session.updatedAtMs = Date.now();
  saveSession(session);

  runtimes.set(session.id, {
    round: roundIndex,
    persona,
    difficulty: startingDifficulty,
    questionsAsked: 0,
    awaitingFollowUp: false,
  });

  return { handoffLine, persona };
}

export async function endRound(session: Session): Promise<void> {
  const rt = runtimeFor(session);
  if (session.agentId) {
    await stopAgent(session.agentId).catch((e) =>
      console.warn("[engine] stopAgent", e)
    );
    session.agentId = undefined;
  }
  const digest = await makeRoundDigest(
    session,
    rt.round,
    rt.persona,
    rt.difficulty
  );
  session.context.digests.push(digest);
  session.status = "between_rounds";
  session.updatedAtMs = Date.now();
  saveSession(session);
  runtimes.delete(session.id);
}

// ─── the proxy turn handler (called from /v1/chat/completions) ───────────────

export interface ProxyTurnResult {
  /** Full interviewer reply text (already TTS-normalised). */
  reply: string;
  verdict: Verdict;
  difficulty: DifficultyLevel;
  forcedFollowUp: boolean;
}

/**
 * Given the message list Agora sent us, produce the interviewer's next line.
 * Streams the reply through `onDelta` (for low voice latency) while also
 * logging the candidate's answer and the interviewer's reply to the DB
 * (the grounding source of truth), with verdict + difficulty + flags.
 */
export async function runProxyTurn(
  sessionId: string,
  incoming: OpenAIMessage[],
  onDelta?: (text: string) => void
): Promise<ProxyTurnResult> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`unknown session ${sessionId}`);
  const rt = runtimeFor(session);

  const lastUser = [...incoming]
    .reverse()
    .find((m) => m.role === "user");
  const candidateText =
    typeof lastUser?.content === "string"
      ? lastUser.content
      : (lastUser?.content ?? [])
          .map((c) => ("text" in c ? c.text : ""))
          .join("");

  // 1. Pre-screen the answer (deterministic, fast).
  const hasRealAnswer = candidateText.trim().length > 0;
  const assessment = hasRealAnswer
    ? assessAnswer(candidateText, collectCandidateClaims(sessionId))
    : { quality: 0.5, vague: false, contradictory: false };

  const forceFollowUp = hasRealAnswer && shouldForceFollowUp(assessment);
  const targetDifficulty = hasRealAnswer
    ? nextDifficulty(rt.difficulty, assessment)
    : rt.difficulty;

  // 2. Log the candidate turn.
  if (hasRealAnswer) {
    appendTurn(sessionId, {
      id: nanoid(10),
      round: rt.round,
      persona: rt.persona,
      role: "candidate",
      text: candidateText.trim(),
      flags: {
        vague: assessment.vague || undefined,
        contradictory: assessment.contradictory || undefined,
        note: assessment.note,
      },
      tsMs: Date.now(),
    });
  }

  // 3. Ask Claude for the interviewer's reply, with a director directive.
  const directive = buildTurnDirective({
    nextDifficulty: targetDifficulty,
    forceFollowUp,
    reason: assessment.vague
      ? "vague / lacking specifics"
      : assessment.contradictory
      ? "contradictory with something said earlier"
      : "weak",
  });

  const withDirective: OpenAIMessage[] = [
    ...incoming,
    { role: "system", content: directive },
  ];
  const { system, messages } = toAnthropicInput(withDirective);

  // Stream from Claude so Agora's TTS can start speaking ASAP. We normalise for
  // TTS per-chunk on a best-effort basis and re-normalise the full text before
  // logging. (Chunk-boundary term splits are rare and low-impact for a demo.)
  let reply = "";
  const stream = anthropic.messages.stream({
    model: config.anthropic.liveModel,
    max_tokens: 400,
    temperature: 0.4,
    system,
    messages,
  });
  for await (const ev of stream) {
    if (
      ev.type === "content_block_delta" &&
      ev.delta.type === "text_delta" &&
      ev.delta.text
    ) {
      reply += ev.delta.text;
      onDelta?.(normalizeForTts(ev.delta.text));
    }
  }
  reply = reply.trim();

  // 4. Parse the spoken verdict prefix the prompt asks for.
  const verdict = parseVerdict(reply);

  // 5. Log the interviewer turn.
  if (!forceFollowUp) rt.questionsAsked += 1;
  rt.difficulty = targetDifficulty;
  rt.awaitingFollowUp = forceFollowUp;
  session.context.currentDifficulty = targetDifficulty;
  saveSession(session);

  // Store the CLEAN interviewer text in the transcript (TTS spellings like
  // "A P I" were only sent over the wire, not persisted).
  appendTurn(sessionId, {
    id: nanoid(10),
    round: rt.round,
    persona: rt.persona,
    role: "interviewer",
    text: reply,
    verdictForPrevAnswer: hasRealAnswer ? verdict : "not_scored",
    difficulty: targetDifficulty,
    tsMs: Date.now(),
  });

  return {
    reply,
    verdict,
    difficulty: targetDifficulty,
    forcedFollowUp: forceFollowUp,
  };
}

function parseVerdict(reply: string): Verdict {
  const head = reply.slice(0, 60).toLowerCase();
  if (head.includes("partially right") || head.includes("partly right"))
    return "partially_right";
  if (
    head.includes("that's not right") ||
    head.includes("that is not right") ||
    head.includes("not quite right") ||
    head.startsWith("that's wrong")
  )
    return "wrong";
  if (head.includes("that's right") || head.includes("that is right"))
    return "right";
  return "not_scored";
}

export function roundCount(session: Session): number {
  return session.context.plan.length;
}

export function getRuntimeSnapshot(sessionId: string): RoundRuntime | undefined {
  return runtimes.get(sessionId);
}

export type { Turn };
