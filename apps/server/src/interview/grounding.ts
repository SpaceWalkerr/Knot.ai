import type {
  EvidenceClaim,
  FinalReport,
  PersonaId,
  Session,
  Turn,
  Verdict,
} from "@knot/shared";
import {
  buildGroundedSummaryPrompt,
  renderTranscriptForSummary,
} from "@knot/shared";
import { claudeText, extractJson } from "../llm/anthropic.js";
import { config } from "../config.js";
import { getTurns } from "../db.js";

interface RawSummary {
  overall: string;
  strengths: RawClaim[];
  weaknesses: RawClaim[];
  perRound: { round: number; persona: string; summary: string }[];
}
interface RawClaim {
  statement: string;
  quote: string;
  round: number;
  persona: string;
  turnId: string;
}

/**
 * Generate the final report, then VERIFY every evidence claim against the real
 * transcript. Claims whose quote can't be matched to a candidate turn are
 * dropped (kept in droppedUnverifiedClaims for debugging). This is the actual
 * grounding guardrail — not the prompt alone.
 */
export async function generateGroundedReport(
  session: Session
): Promise<FinalReport> {
  const turns = getTurns(session.id);
  const candidateTurns = turns.filter((t) => t.role === "candidate");

  const raw = await claudeText({
    model: config.anthropic.summaryModel,
    system: buildGroundedSummaryPrompt(session.context.candidate.name),
    user:
      `Full interview transcript (${turns.length} turns):\n\n` +
      renderTranscriptForSummary(turns),
    // this is an extraction task, not deep reasoning — the grounding rigor comes
    // from the verification pass below, not from the model thinking hard. Keep
    // effort modest so the token budget goes to the JSON, not to thinking.
    maxTokens: 6000,
    effort: "medium",
  });

  const parsed = extractJson<RawSummary>(raw);

  const verify = (c: RawClaim): EvidenceClaim => {
    const claim: EvidenceClaim = {
      statement: c.statement,
      quote: c.quote,
      round: c.round,
      persona: c.persona as PersonaId,
      turnId: c.turnId,
      verified: isQuoteGrounded(c.quote, c.turnId, candidateTurns),
    };
    return claim;
  };

  const strengthsAll = (parsed.strengths ?? []).map(verify);
  const weaknessesAll = (parsed.weaknesses ?? []).map(verify);

  const strengths = strengthsAll.filter((c) => c.verified);
  const weaknesses = weaknessesAll.filter((c) => c.verified);
  const dropped = [...strengthsAll, ...weaknessesAll].filter((c) => !c.verified);

  return {
    sessionId: session.id,
    candidateName: session.context.candidate.name,
    overall: parsed.overall ?? "",
    strengths,
    weaknesses,
    perRound: buildPerRound(session, turns, parsed),
    droppedUnverifiedClaims: dropped,
    generatedAtMs: Date.now(),
  };
}

/** Fuzzy containment: the quote (normalised) must appear within a candidate turn. */
function isQuoteGrounded(
  quote: string,
  turnId: string,
  candidateTurns: Turn[]
): boolean {
  const q = norm(quote);
  if (q.length < 8) return false; // too short to be meaningful evidence

  const exact = candidateTurns.find((t) => t.id === turnId);
  if (exact && norm(exact.text).includes(q)) return true;

  // turnId may be slightly off; accept a match against any candidate turn
  if (candidateTurns.some((t) => norm(t.text).includes(q))) return true;

  // last resort: token-overlap >= 0.8 against the cited turn
  if (exact) {
    const qt = new Set(q.split(" "));
    const tt = new Set(norm(exact.text).split(" "));
    const overlap = [...qt].filter((w) => tt.has(w)).length / qt.size;
    return overlap >= 0.8;
  }
  return false;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPerRound(
  session: Session,
  turns: Turn[],
  parsed: RawSummary
): FinalReport["perRound"] {
  const rounds = [...new Set(turns.map((t) => t.round))].sort((a, b) => a - b);
  return rounds.map((round) => {
    const persona =
      (turns.find((t) => t.round === round)?.persona as PersonaId) ??
      session.context.plan[round - 1];
    const tally: Record<Verdict, number> = {
      right: 0,
      partially_right: 0,
      wrong: 0,
      not_scored: 0,
    };
    for (const t of turns) {
      if (t.round === round && t.verdictForPrevAnswer) {
        tally[t.verdictForPrevAnswer]++;
      }
    }
    const summary =
      parsed.perRound?.find((p) => p.round === round)?.summary ?? "";
    return { round, persona, summary, verdictTally: tally };
  });
}
