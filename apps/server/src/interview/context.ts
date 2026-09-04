import type {
  DifficultyLevel,
  PersonaId,
  RoundDigest,
  Session,
  Turn,
} from "@knot/shared";
import { buildDigestPrompt } from "@knot/shared";
import { claudeText, extractJson } from "../llm/anthropic.js";
import { config } from "../config.js";
import { getTurns } from "../db.js";

/**
 * After a round ends, condense it into a RoundDigest. This is the ONLY thing
 * that crosses into the next persona's prompt, so it must be factual and
 * grounded in the round transcript.
 */
export async function makeRoundDigest(
  session: Session,
  round: number,
  persona: PersonaId,
  endDifficulty: DifficultyLevel
): Promise<RoundDigest> {
  const turns = getTurns(session.id, round);
  const transcript = turns
    .map((t) => `[${t.role}] ${t.text}`)
    .join("\n");

  try {
    const raw = await claudeText({
      model: config.anthropic.summaryModel,
      system: buildDigestPrompt(round, persona),
      user: `Transcript of round ${round}:\n\n${transcript}`,
      maxTokens: 1200,
      effort: "low",
    });
    const parsed = extractJson<{
      bullets: string[];
      coveredTopics: string[];
      endDifficulty: number;
    }>(raw);
    return {
      round,
      persona,
      bullets: parsed.bullets?.slice(0, 6) ?? [],
      coveredTopics: parsed.coveredTopics?.slice(0, 12) ?? [],
      endDifficulty: clampDifficulty(parsed.endDifficulty ?? endDifficulty),
    };
  } catch (err) {
    console.warn("[context] digest failed, using fallback", err);
    return {
      round,
      persona,
      bullets: [
        `Round ${round} completed with ${turns.length} turns; automatic digest unavailable.`,
      ],
      coveredTopics: [],
      endDifficulty,
    };
  }
}

function clampDifficulty(n: number): DifficultyLevel {
  return Math.max(1, Math.min(5, Math.round(n))) as DifficultyLevel;
}

/** Candidate factual claims so far, for the naive contradiction pre-screen. */
export function collectCandidateClaims(sessionId: string): string[] {
  return getTurns(sessionId)
    .filter((t: Turn) => t.role === "candidate")
    .map((t) => t.text)
    .filter((s) => s.split(/\s+/).length >= 6);
}
