import type { DifficultyLevel } from "@knot/shared";

export interface AnswerAssessment {
  /** rough 0..1 signal, kept for logging/telemetry only — NOT the ladder driver. */
  quality: number;
  vague: boolean;
  contradictory: boolean;
  tooShort: boolean;
  note?: string;
}

/**
 * Cheap deterministic pre-screen. We deliberately do NOT try to grade
 * correctness here (a regex can't). We only detect the three things a regex
 * CAN reliably catch — a non-answer, hedge-without-specifics, and a direct
 * self-contradiction — and use those to hold/step-down the difficulty ladder
 * and to force follow-ups. Correctness feedback is the interviewer LLM's job.
 */
export function assessAnswer(
  text: string,
  priorClaims: string[] = []
): AnswerAssessment {
  const t = text.trim().toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);

  const tooShort = words.length < 8;

  const vaguePhrases = [
    "it depends",
    "best practice",
    "best practices",
    "various things",
    "a bunch of stuff",
    "you know",
    "kind of just",
    "i guess",
    "generally speaking",
    "the usual stuff",
    "standard stuff",
  ];
  const vagueHits = vaguePhrases.filter((p) => t.includes(p)).length;

  const concreteSignals = [
    /\b\d+(\.\d+)?\s?(ms|s|gb|mb|kb|rps|qps|%|x|k|m|users|nodes|shards|replicas|years|months)\b/,
    /\bbecause\b/,
    /\bfor example\b|\bfor instance\b|\be\.g\.\b/,
    /\bwe (measured|benchmarked|saw|found)\b|\bi (measured|benchmarked|saw|found)\b/,
    /\btrade-?off\b/,
    /\bspecifically\b/,
  ];
  const concreteHits = concreteSignals.filter((re) => re.test(t)).length;

  // naive contradiction: candidate negates something close to an earlier claim
  let contradictory = false;
  let note: string | undefined;
  const negation = /\b(didn't|did not|never actually|not really|wasn't|was not)\b/;
  if (negation.test(t)) {
    for (const claim of priorClaims) {
      const kws = claim
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 5);
      const overlap = kws.filter((w) => t.includes(w)).length;
      if (overlap >= 2) {
        contradictory = true;
        note = `possible contradiction with earlier: "${claim.slice(0, 70)}"`;
        break;
      }
    }
  }

  const vague = !tooShort && (vagueHits >= 1 && concreteHits === 0);

  let quality = 0.55 + 0.1 * concreteHits - 0.2 * vagueHits;
  if (tooShort) quality = 0.2;
  quality = Math.max(0, Math.min(1, quality));

  return { quality, vague, contradictory, tooShort, note };
}

/** An answer that doesn't trip any flag — the candidate is handling this level. */
export function isSolid(a: AnswerAssessment): boolean {
  return !a.vague && !a.contradictory && !a.tooShort;
}

/**
 * Streak-based ladder. Two consecutive solid answers => step up one level.
 * A flagged answer resets the streak; a contradiction steps down one.
 * Never moves more than one level per turn; never escalates on a flagged answer.
 */
export function nextDifficulty(
  current: DifficultyLevel,
  a: AnswerAssessment,
  solidStreak: number
): { level: DifficultyLevel; solidStreak: number } {
  let level = current as number;
  let streak = solidStreak;

  if (a.contradictory) {
    level = current - 1;
    streak = 0;
  } else if (a.vague || a.tooShort) {
    streak = 0; // hold
  } else {
    streak = solidStreak + 1;
    if (streak >= 2) {
      level = current + 1;
      streak = 0;
    }
  }

  level = Math.max(1, Math.min(5, level));
  return { level: level as DifficultyLevel, solidStreak: streak };
}

export function shouldForceFollowUp(a: AnswerAssessment): boolean {
  return a.vague || a.contradictory || a.tooShort;
}
