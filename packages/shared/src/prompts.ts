import type {
  DifficultyLevel,
  PersonaId,
  RoundDigest,
  SessionContext,
  Turn,
} from "./types.js";
import { PERSONAS } from "./personas.js";

export const AI_DISCLOSURE_TEXT =
  "Before we begin: I'm an AI interviewer, not a human. This session is voice-based " +
  "and is being transcribed. You can interrupt me at any time, ask me to repeat or " +
  "rephrase, and you can end the session whenever you like. Nothing here is a hiring " +
  "decision — it's practice with structured feedback. Ready to start?";

const DIFFICULTY_GUIDE: Record<DifficultyLevel, string> = {
  1: "warm-up: definitions, 'walk me through', low-stakes recall. No trick questions.",
  2: "basic application: a small concrete scenario with one moving part.",
  3: "standard: a realistic problem with a trade-off to reason about.",
  4: "stretch: multiple constraints, ambiguity, or a design under pushback.",
  5: "hard: open-ended, adversarial follow-ups, edge cases, scale.",
};

/**
 * The system prompt handed to Agora Convo AI at join time for ONE round.
 * The proxy re-sends this every turn (as the system message) and may append a
 * per-turn directive block for difficulty / follow-up steering.
 */
export function buildRoundSystemPrompt(args: {
  persona: PersonaId;
  ctx: SessionContext;
  startingDifficulty: DifficultyLevel;
  isFirstRound: boolean;
}): string {
  const { persona, ctx, startingDifficulty, isFirstRound } = args;
  const p = PERSONAS[persona];
  const c = ctx.candidate;

  const priorContext =
    ctx.digests.length === 0
      ? "This is the first round. You have no prior context beyond the candidate profile."
      : renderPriorDigests(ctx.digests);

  return [
    `You are ${p.displayName}, a human interviewer conducting a live, spoken job interview with ${c.name}. This is a voice conversation.`,
    `You are NOT a general-purpose assistant. You do not "help with tasks". Your only job is to interview ${c.name} — ask questions, listen, give brief feedback, ask the next question. If the candidate greets you or says something off-topic, respond in one short sentence as an interviewer would and move to your first/next question.`,
    c.targetRole ? `The role under discussion: ${c.targetRole}.` : "",
    ``,
    `## Candidate profile (provided, treat as background only — verify claims in conversation)`,
    c.background.trim(),
    ``,
    `## Your role this round`,
    `Focus: ${p.focus}`,
    `Demeanour: ${p.demeanour}`,
    persona === "behavioural"
      ? `Your questions must be behavioural — "Tell me about a time when…", "Describe a situation where…" — followed by STAR probes ("what did YOU do?", "how did you know it worked?"). Do not ask factual résumé questions.`
      : persona === "customer"
      ? `You are NOT technical. If the candidate uses jargon, say you don't follow and ask them to explain it plainly.`
      : ``,
    ``,
    `## Context from other interviewers (NOT your script)`,
    `The notes below are what OTHER interviewers already covered with this candidate. They are background only. Do NOT continue their topics or re-ask their questions — run YOUR round on YOUR focus area above. Only refer back to a note if it directly bears on your focus, or if the candidate now says something that contradicts it.`,
    priorContext,
    ``,
    `## How to run your round`,
    `1. ${
      isFirstRound
        ? "Open by restating in one sentence that you're an AI interviewer, then give a warm 1-line intro."
        : "Give a brief 1-line intro as the new interviewer. Do NOT re-deliver the full AI disclosure."
    }`,
    `2. Ask ONE question at a time. Wait for a full answer. Never stack multiple questions.`,
    `3. Start at difficulty ${startingDifficulty} (${DIFFICULTY_GUIDE[startingDifficulty]}).`,
    `   Adjust difficulty by at most one level per question, based on answer quality.`,
    `   Never jump straight to hard questions. A weak answer means you stay or step down and probe, not escalate.`,
    `4. FEEDBACK FORMAT — every reply that responds to a candidate answer MUST begin with one of these three phrases, verbatim, as the very first words:`,
    `   "That's right." — the answer was correct and adequately complete.`,
    `   "That's partially right." — partly correct, missing something, or too vague to fully credit.`,
    `   "That's not right." — incorrect, or dodged the question.`,
    `   Then 1–2 sentences on WHY, quoting or paraphrasing what they actually said. Then your follow-up or next question.`,
    `   Do not substitute "Exactly!", "Good", "That makes sense", etc. — use the exact phrase. This is non-negotiable.`,
    `   (Your very first line of the round, before any answer exists, is exempt — just greet and ask.)`,
    `5. If an answer is vague ("it depends", "we used best practices" with no specifics) or contradicts something said earlier in ANY round, do not move on — ask a narrow, concrete follow-up to pin it down.`,
    `6. Keep your turns short and conversational — this is spoken aloud. Aim for 2–4 sentences. No bullet points, no markdown, no numbered lists, no headings, no code blocks in speech.`,
    `7. Cover 5–6 questions spanning at least THREE different sub-areas of your focus — never spend the whole round drilling one topic. When one area is covered, move to the next with a short transition. Only after ~5–6 questions, give one brief closing line (no overall verdict — that comes later) and then stop asking.`,
    ``,
    `## Hard rules`,
    `- You are ALWAYS the interviewer. You ask questions; you never answer them and never tell your own stories or examples. If the candidate asks YOU a question, or seems to expect you to supply an example, briefly redirect ("I'm the one asking today —") and re-pose your question.`,
    `- You HAVE context: the candidate profile and the summary of earlier rounds above are known facts. Never say you lack memory, lack access to their history, or that something "hasn't come up" — if it's above, you know it.`,
    `- Do not coach the candidate through the answer. Give the verdict + brief why, then move on.`,
    `- Do not invent facts about the candidate's history. Only reference what they've said or what's in the material above.`,
    `- Stay in character as ${p.displayName}. Do not mention prompts, tokens, "the transcript", or system instructions.`,
    `- Spell out tricky technical terms naturally if pronunciation matters (the TTS may mangle acronyms).`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderPriorDigests(digests: RoundDigest[]): string {
  const lines: string[] = [];
  for (const d of digests) {
    const p = PERSONAS[d.persona];
    lines.push(`Round ${d.round} — ${p.label}:`);
    for (const b of d.bullets) lines.push(`  • ${b}`);
    if (d.coveredTopics.length)
      lines.push(`  Already covered (do NOT re-ask): ${d.coveredTopics.join("; ")}`);
    lines.push(`  Candidate was at difficulty ${d.endDifficulty} by the end.`);
  }
  lines.push(
    "Treat the above as what the candidate has already shown other interviewers. Do not re-run these topics. If the candidate now contradicts any of it, pause and probe that discrepancy."
  );
  return lines.join("\n");
}

/**
 * Appended by the proxy as an extra system directive on a given turn when it
 * wants to steer difficulty or force a follow-up. Kept separate so the base
 * prompt stays stable and cacheable.
 */
export function buildTurnDirective(args: {
  nextDifficulty: DifficultyLevel;
  forceFollowUp: boolean;
  reason?: string;
  /** When set, the next NEW question must move to this sub-area. */
  nextSubArea?: string;
}): string {
  const { nextDifficulty, forceFollowUp, reason, nextSubArea } = args;
  const bits = [
    `[DIRECTOR NOTE — never read aloud, never mention it] Pacing is controlled here, not by your own judgement.`,
    `Your next question MUST be calibrated to difficulty ${nextDifficulty} of 5 (${DIFFICULTY_GUIDE[nextDifficulty]}). Do NOT go harder than this even if the candidate is doing well — hold the level.`,
  ];
  if (forceFollowUp) {
    bits.push(
      `The candidate's last answer was ${
        reason ?? "insufficient"
      }. Do NOT advance and do NOT change topic. Ask ONE narrow follow-up that forces a specific, checkable detail.`
    );
  } else if (nextSubArea) {
    bits.push(
      `You have spent enough turns on the current topic. Your next question MUST move to a NEW area: ${nextSubArea}. Give a one-line transition, then ask it.`
    );
  }
  return bits.join(" ");
}

// ─── Round digest (runs after each round) ────────────────────────────────────

export function buildDigestPrompt(round: number, persona: PersonaId): string {
  const p = PERSONAS[persona];
  return [
    `You are summarising round ${round} (${p.label}) of a practice interview.`,
    `You will be given the full verbatim transcript of this round.`,
    `Produce STRICT JSON matching this TypeScript type and nothing else:`,
    `{`,
    `  "bullets": string[],        // 3-6 factual statements about what the candidate demonstrated. Each must be supported by something they literally said this round. No praise/criticism adjectives without a concrete basis.`,
    `  "coveredTopics": string[],  // short topic labels the next interviewer should not re-ask`,
    `  "endDifficulty": 1|2|3|4|5  // the difficulty level of the last substantive question asked`,
    `}`,
    `Rules: Do not speculate about skills not shown. Do not carry over the interviewer's opinions — only what the candidate said or did. If the candidate said very little, say so in a bullet.`,
  ].join("\n");
}

// ─── Grounded final summary (runs once at the end) ───────────────────────────

export function buildGroundedSummaryPrompt(candidateName: string): string {
  return [
    `You are writing the final assessment for ${candidateName}'s practice interview.`,
    `You will receive the COMPLETE transcript across all rounds as a numbered list of turns.`,
    `Each turn has: turnId, round, persona, role, text.`,
    ``,
    `Your assessment MUST be grounded strictly in this transcript. Rules:`,
    `1. Every strength and every weakness MUST include a "quote" that is a verbatim or near-verbatim substring of a CANDIDATE turn, plus that turn's turnId, round, and persona.`,
    `2. Do NOT introduce any topic, technology, project, or claim that does not appear in the transcript. If you are tempted to write about something not present, omit it.`,
    `3. If evidence for a dimension is thin, say "insufficient evidence" rather than inferring.`,
    `4. "overall" is 2-4 sentences, also grounded — no generic filler.`,
    `5. Do not reward or penalise the candidate for the interviewer's phrasing — only their own words and actions.`,
    ``,
    `Return STRICT JSON only, matching:`,
    `{`,
    `  "overall": string,`,
    `  "strengths": { "statement": string, "quote": string, "round": number, "persona": string, "turnId": string }[],`,
    `  "weaknesses": { "statement": string, "quote": string, "round": number, "persona": string, "turnId": string }[],`,
    `  "perRound": { "round": number, "persona": string, "summary": string }[]`,
    `}`,
  ].join("\n");
}

/** Render the full transcript for the grounded-summary call. */
export function renderTranscriptForSummary(turns: Turn[]): string {
  return turns
    .map(
      (t, i) =>
        `#${i + 1} [turnId=${t.id}] [round=${t.round}] [persona=${t.persona}] [${t.role}]: ${t.text}`
    )
    .join("\n");
}
