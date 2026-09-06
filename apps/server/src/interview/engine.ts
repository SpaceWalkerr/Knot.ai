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
  VERDICT_SPOKEN,
  VERDICT_FROM_TAG,
  VERDICT_TAG_RE,
  LEADING_VERDICT_PROSE_RE,
  type VerdictTag,
} from "@knot/shared";
import { config } from "../config.js";
import { appendTurn, getSession, getTurns, saveSession } from "../db.js";
import { startAgent, stopAgent } from "../agora/convoAgent.js";
import {
  anthropic,
  toAnthropicInput,
  type OpenAIMessage,
} from "../llm/anthropic.js";
import {
  assessAnswer,
  nextDifficulty,
  shouldForceFollowUp,
  type AnswerAssessment,
} from "./difficulty.js";
import { makeRoundDigest, collectCandidateClaims } from "./context.js";
import { normalizeForTts } from "./ttsNormalize.js";

/** Per-round runtime state. In-memory is fine for a single-node hackathon server. */
interface RoundRuntime {
  round: number;
  persona: PersonaId;
  difficulty: DifficultyLevel;
  /** consecutive un-flagged answers at the current level (drives the ladder). */
  solidStreak: number;
  questionsAsked: number;
  awaitingFollowUp: boolean;
  /** which persona sub-area the round is currently on. */
  subAreaIndex: number;
  /** new (non-follow-up) questions asked within the current sub-area. */
  questionsInSubArea: number;
  /** the round's opening line — used to anchor the model in-character on turn 1. */
  greeting: string;
  /** the persona prompt for this round; the proxy injects it on every turn. */
  systemPrompt: string;
}

const QUESTIONS_PER_SUBAREA = 2;
const runtimes = new Map<string, RoundRuntime>();

/** Last Agora join diagnostics per session — exposed via /api/session/:id/debug. */
export const agentDiag = new Map<string, Record<string, unknown>>();

function runtimeFor(session: Session): RoundRuntime {
  let r = runtimes.get(session.id);
  if (!r) {
    r = {
      round: session.context.currentRound,
      persona: session.context.currentPersona,
      difficulty: session.context.currentDifficulty,
      solidStreak: 0,
      questionsAsked: getTurns(session.id, session.context.currentRound).filter(
        (t) => t.role === "interviewer"
      ).length,
      awaitingFollowUp: false,
      subAreaIndex: 0,
      questionsInSubArea: 0,
      greeting: "",
      // Rebuilt rather than stored, so a server restart mid-round still sends
      // the right persona prompt (with whatever digests exist by now).
      systemPrompt: buildRoundSystemPrompt({
        persona: session.context.currentPersona,
        ctx: session.context,
        startingDifficulty: session.context.currentDifficulty,
        isFirstRound: session.context.currentRound <= 1,
      }),
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
    : `Hi ${session.context.candidate.name}, I'm ${p.displayName}. I'm going to shift focus from the last round — I want to dig into ${p.focus.split(":")[0]}. Let's start with something straightforward.`;

  const agent = await startAgent({
    sessionId: session.id,
    channel: session.channel,
    systemPrompt,
    greeting,
    voiceHint: p.voiceHint,
  });
  if (agent.diag) {
    agentDiag.set(session.id, {
      round: roundIndex,
      persona,
      agentId: agent.agentId,
      ...agent.diag,
    });
  }

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
    solidStreak: 0,
    questionsAsked: 0,
    awaitingFollowUp: false,
    subAreaIndex: 0,
    questionsInSubArea: 0,
    greeting,
    systemPrompt,
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

  // The first candidate utterance of a round is a greeting, not an answer —
  // don't score it or force a follow-up on it. (No assistant turn in history
  // yet means Agora has only spoken its greeting_message.)
  const isRoundOpener = !incoming.some((m) => m.role === "assistant");

  // 1. Pre-screen the answer (deterministic, fast).
  const hasRealAnswer = !isRoundOpener && candidateText.trim().length > 0;
  const assessment: AnswerAssessment = hasRealAnswer
    ? assessAnswer(candidateText, collectCandidateClaims(sessionId))
    : { quality: 0.5, vague: false, contradictory: false, tooShort: false };

  const forceFollowUp = hasRealAnswer && shouldForceFollowUp(assessment);
  const ladder = hasRealAnswer
    ? nextDifficulty(rt.difficulty, assessment, rt.solidStreak)
    : { level: rt.difficulty, solidStreak: rt.solidStreak };
  const targetDifficulty = ladder.level;

  if (process.env.KNOT_DEBUG) {
    console.log(
      `[turn] r${rt.round} area=${rt.subAreaIndex}(${rt.questionsInSubArea}q) vague=${assessment.vague} short=${assessment.tooShort} contra=${assessment.contradictory} diff ${rt.difficulty}->${targetDifficulty} streak=${rt.solidStreak}->${ladder.solidStreak} force=${forceFollowUp}`
    );
  }

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

  // 3a. Sub-area rotation — force the interviewer off a topic after a couple of
  //     real questions so it can't tunnel. Advance when the current sub-area is
  //     spent and another remains.
  const subAreas = PERSONAS[rt.persona].subAreas;
  let nextSubArea: string | undefined;
  if (isRoundOpener) {
    nextSubArea = subAreas[0];
  } else if (
    !forceFollowUp &&
    rt.questionsInSubArea >= QUESTIONS_PER_SUBAREA &&
    rt.subAreaIndex < subAreas.length - 1
  ) {
    rt.subAreaIndex += 1;
    rt.questionsInSubArea = 0;
    nextSubArea = subAreas[rt.subAreaIndex];
  }

  // 3b. Ask Claude for the interviewer's reply, with a director directive.
  const directive = buildTurnDirective({
    nextDifficulty: targetDifficulty,
    forceFollowUp,
    nextSubArea,
    reason: assessment.vague
      ? "vague / lacking specifics"
      : assessment.contradictory
      ? "contradictory with something said earlier"
      : "weak",
  });

  // Anchor the model in-character: Agora restarts the agent each round, so the
  // first proxy call of a round arrives with only a user message and no
  // assistant history — without an anchor the model can slip into
  // generic-assistant mode. Prepend the round's spoken greeting as the first
  // assistant turn (this mirrors what Agora's greeting_message does live).
  const anchored: OpenAIMessage[] =
    isRoundOpener && rt.greeting
      ? [{ role: "assistant", content: rt.greeting }, ...incoming]
      : incoming;

  // The persona prompt is injected HERE rather than relied upon from the
  // caller. Agora is configured with `system_messages` at join time, but it
  // also applies `max_history: 32`, and `scripts/sim.mjs` never sent one at
  // all — which meant the persona character, the cross-round digests and the
  // verdict rule were silently absent from every simulated run. The proxy owns
  // interview control, so it owns the prompt too.
  const withDirective: OpenAIMessage[] = [
    { role: "system", content: rt.systemPrompt },
    ...anchored.filter((m) => m.role !== "system" && m.role !== "developer"),
    { role: "system", content: directive },
  ];
  const { system, messages } = toAnthropicInput(withDirective);

  // Stream from Claude so Agora's TTS can start speaking ASAP. We normalise for
  // TTS per-chunk on a best-effort basis and re-normalise the full text before
  // logging. (Chunk-boundary term splits are rare and low-impact for a demo.)
  // The reply opens with a verdict tag (<right>/<partial>/<wrong>) which must
  // never reach TTS. Hold the first few characters back until the tag either
  // resolves or clearly isn't coming, then speak OUR verdict sentence in front
  // of the model's words. `spoken` is the clean text; `onDelta` gets the
  // TTS-normalised version.
  //
  // (Assistant prefill would make the tag structurally unskippable, but
  // sonnet-5 rejects it: "This model does not support assistant message
  // prefill". The instruction alone holds well because a tag is out-of-band —
  // unlike the exact spoken sentence it replaced, it doesn't compete with the
  // model's own phrasing.)
  const stream = anthropic.messages.stream({
    model: config.anthropic.liveModel,
    max_tokens: 600,
    // sonnet-5 removed temperature/top_p/top_k (400 if sent). Keep turns fast and
    // terse for voice with low effort; we only forward text deltas, so adaptive
    // thinking (if it fires) never reaches TTS.
    output_config: { effort: "low" },
    system,
    messages,
  });

  const HEAD_LIMIT = 24;
  let spoken = "";
  let head = "";
  let tag: VerdictTag | undefined;
  let tagResolved = false;
  // True between emitting the verdict sentence and the first word after it, so
  // the join gets exactly one space however the deltas happen to split.
  let needsGap = false;

  const emit = (text: string) => {
    if (!text) return;
    spoken += text;
    onDelta?.(normalizeForTts(text));
  };

  const emitBody = (text: string) => {
    if (needsGap) {
      const trimmed = text.replace(/^\s+/, "");
      if (!trimmed) return; // still whitespace — wait for a real word
      needsGap = false;
      emit(" " + trimmed);
      return;
    }
    emit(text);
  };

  for await (const ev of stream) {
    if (
      ev.type !== "content_block_delta" ||
      ev.delta.type !== "text_delta" ||
      !ev.delta.text
    ) {
      continue;
    }
    const text = ev.delta.text;

    if (tagResolved) {
      emitBody(text);
      continue;
    }

    head += text;
    const m = VERDICT_TAG_RE.exec(head);
    if (m) {
      tagResolved = true;
      const rest = head.slice(m[0].length).replace(LEADING_VERDICT_PROSE_RE, "");
      if (hasRealAnswer) {
        // WE say the verdict, verbatim — the model only supplied the judgement.
        tag = m[1].toLowerCase() as VerdictTag;
        emit(VERDICT_SPOKEN[tag]);
        needsGap = true;
      }
      // A round opener grades nothing, so any tag the model emitted anyway is
      // dropped without a verdict sentence.
      emitBody(rest);
    } else if (head.length >= HEAD_LIMIT) {
      // No tag is coming. Speak what we buffered rather than swallowing it.
      tagResolved = true;
      emitBody(head);
    }
  }
  // Stream ended while still inside the buffer (a very short reply).
  if (!tagResolved) emitBody(head);

  // An empty reply would leave the agent silent mid-interview.
  const reply =
    spoken.trim() ||
    "Sorry — could you say a little more about that?";

  if (process.env.KNOT_DEBUG && hasRealAnswer) {
    console.log(`[turn] verdict tag: ${tag ?? "MISSING (fell back to flags)"}`);
  }

  // 4. Verdict for the report tally. The model's tag is the correctness signal
  //    (a regex can't grade an answer); if it went missing, fall back to the
  //    model's prose, then to the deterministic flags. Whatever we land on is
  //    the SAME value the candidate just heard, so the spoken verdict and the
  //    report tally can never disagree.
  const fromProse = parseVerdict(reply);
  const verdict: Verdict = !hasRealAnswer
    ? "not_scored"
    : tag
    ? VERDICT_FROM_TAG[tag]
    : fromProse !== "not_scored"
    ? fromProse
    : verdictFromAssessment(assessment);

  // 5. Log the interviewer turn.
  if (!forceFollowUp && !isRoundOpener) {
    rt.questionsAsked += 1;
    rt.questionsInSubArea += 1;
  }
  rt.difficulty = targetDifficulty;
  rt.solidStreak = ladder.solidStreak;
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
    verdictForPrevAnswer: verdict,
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
  const head = reply.slice(0, 70).toLowerCase();
  // partial first — "partially right" also contains "right"
  if (
    /\b(partially|partly)\s+(right|correct)\b/.test(head) ||
    head.includes("not quite") ||
    head.includes("sort of right") ||
    head.includes("close, but") ||
    head.includes("close but")
  )
    return "partially_right";
  if (
    /that'?s\s+(not|wrong|incorrect)/.test(head) ||
    /\bnot right\b/.test(head) ||
    head.startsWith("no,") ||
    head.startsWith("no —") ||
    head.startsWith("incorrect") ||
    head.includes("that isn't right") ||
    head.includes("that's not correct")
  )
    return "wrong";
  if (
    /that'?s\s+(right|correct)\b/.test(head) ||
    head.startsWith("exactly") ||
    head.startsWith("correct") ||
    head.startsWith("spot on") ||
    head.includes("that's exactly right")
  )
    return "right";
  return "not_scored";
}

/**
 * Fallback verdict when the interviewer didn't use an explicit verdict phrase.
 * Flag-driven (a regex can't grade correctness, but it can spot a non-answer):
 * a contradiction is wrong, a vague/too-short answer is partial, an answer that
 * trips no flag is credited as right.
 */
function verdictFromAssessment(a: AnswerAssessment): Verdict {
  if (a.contradictory) return "wrong";
  if (a.vague || a.tooShort) return "partially_right";
  return "right";
}

export function roundCount(session: Session): number {
  return session.context.plan.length;
}

export function getRuntimeSnapshot(sessionId: string): RoundRuntime | undefined {
  return runtimes.get(sessionId);
}

export type { Turn };
