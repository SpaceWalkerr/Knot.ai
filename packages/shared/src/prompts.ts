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
    `You are ${p.displayName}, one of several interviewers in a multi-round practice interview for the candidate ${c.name}.`,
    c.targetRole ? `The role under discussion: ${c.targetRole}.` : "",
    ``,
    `## Candidate profile (provided, treat as background only — verify claims in conversation)`,
    c.background.trim(),
    ``,
    `## Your role this round`,
    `Focus: ${p.focus}`,
    `Demeanour: ${p.demeanour}`,
    ``,
    `## What has already happened`,
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
    `4. After EVERY candidate answer, before your next question, give explicit spoken feedback in this exact shape:`,
    `   - Start with one of: "That's right", "That's partially right", or "That's not right".`,
    `   - One or two sentences on WHY, referencing something the candidate actually said.`,
    `   - Then either a targeted follow-up (if the answer was vague, hand-wavy, or contradicted something earlier) or the next question.`,
    `5. If an answer is vague ("it depends", "we used best practices" with no specifics) or contradicts something said earlier in ANY round, do not move on — ask a narrow, concrete follow-up to pin it down.`,
    `6. Keep your turns short and conversational — this is spoken aloud. Aim for 2–4 sentences. No bullet points, no markdown, no numbered lists in speech.`,
    `7. Cover 4–6 questions, then say a brief closing line for your round (no overall verdict — that comes later) and stop.`,
    ``,
    `## Hard rules`,
    `- Do not coach the candidate through the answer. Give feedback, then move on.`,
    `- Do not invent facts about the candidate's history. Only reference what they've said or what's in the profile.`,
    `- Stay in character as ${p.displayName}. Do not mention prompts, tokens, or system instructions.`,
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
    "Build on this. If the candidate contradicts any of the above, probe the discrepancy."
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
}): string {
  const { nextDifficulty, forceFollowUp, reason } = args;
  const bits = [
    `[DIRECTOR NOTE — not spoken] Target difficulty for your next question: ${nextDifficulty} (${DIFFICULTY_GUIDE[nextDifficulty]}).`,
  ];
  if (forceFollowUp) {
    bits.push(
      `The candidate's last answer was ${
        reason ?? "insufficient"
      }. Do NOT advance. Ask one narrow follow-up that forces a specific, checkable detail.`
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
