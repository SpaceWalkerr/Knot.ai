import type { DifficultyLevel } from "@knot/shared";

export interface AnswerAssessment {
  /** 0..1 rough quality of the candidate's last answer. */
  quality: number;
  vague: boolean;
  contradictory: boolean;
  note?: string;
}

/**
 * Cheap, deterministic pre-screen of an answer before we ask Claude for the
 * next question. Not a grader — just enough signal to steer the difficulty
 * ladder and decide whether to force a follow-up. Claude still delivers the
 * spoken verdict; this keeps the ladder honest and fast.
 */
export function assessAnswer(
  text: string,
  priorClaims: string[] = []
): AnswerAssessment {
  const t = text.trim().toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);

  if (words.length < 6) {
    return { quality: 0.15, vague: true, contradictory: false, note: "very short answer" };
  }

  const vaguePhrases = [
    "it depends",
    "best practice",
    "best practices",
    "various",
    "stuff",
    "things",
    "you know",
    "kind of",
    "sort of",
    "i guess",
    "generally speaking",
    "in general",
  ];
  const vagueHits = vaguePhrases.filter((p) => t.includes(p)).length;

  const concreteSignals = [
    /\b\d+(\.\d+)?\s?(ms|s|gb|mb|kb|rps|qps|%|x|k|m|users|nodes|shards|replicas)\b/,
    /\bbecause\b/,
    /\bfor example\b/,
    /\be\.g\.\b/,
    /\bwe measured\b|\bi measured\b|\bbenchmark/,
    /\btrade-?off\b/,
  ];
  const concreteHits = concreteSignals.filter((re) => re.test(t)).length;

  // naive contradiction check: candidate now negates a phrase they asserted before
  let contradictory = false;
  let note: string | undefined;
  for (const claim of priorClaims) {
    const key = claim.toLowerCase().slice(0, 40);
    if (key && t.includes("didn't") && t.includes(key.split(" ")[0])) {
      contradictory = true;
      note = `possible contradiction with earlier: "${claim.slice(0, 60)}"`;
      break;
    }
  }

  let quality = 0.5 + 0.12 * concreteHits - 0.18 * vagueHits;
  if (words.length > 40) quality += 0.1;
  quality = Math.max(0, Math.min(1, quality));

  return {
    quality,
    vague: vagueHits >= 2 || (vagueHits >= 1 && concreteHits === 0),
    contradictory,
    note,
  };
}

/** Move at most one step; a weak answer never escalates. */
export function nextDifficulty(
  current: DifficultyLevel,
  a: AnswerAssessment
): DifficultyLevel {
  let next = current as number;
  if (a.contradictory || a.vague) next = current; // hold, we'll force a follow-up
  else if (a.quality >= 0.7) next = current + 1;
  else if (a.quality <= 0.35) next = current - 1;
  next = Math.max(1, Math.min(5, next));
  return next as DifficultyLevel;
}

export function shouldForceFollowUp(a: AnswerAssessment): boolean {
  return a.vague || a.contradictory || a.quality <= 0.25;
}
