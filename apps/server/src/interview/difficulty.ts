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
 * Words that are long enough to look distinctive but carry no topic. Without
 * this filter, any two answers that both contain e.g. "because" and "actually"
 * look like they overlap.
 */
const COMMON = new Set(
  ("about above after again against along already also although always among another around because " +
    "become been before being below better between both business came cannot come could different doing " +
    "done down during each either enough especially even every everything exactly example first from " +
    "further getting given going great guess happen happened having here honestly however into itself " +
    "just keep kind know later least like little long look looking made make making many matter maybe " +
    "mean might more most much must need needed never next nothing other others over part people perhaps " +
    "place point probably problem quite rather really right said same seem seemed several should since " +
    "some someone something sometimes still such sure take taken tell than that their them then there " +
    "these they thing things think this those though thought three through time times together told took " +
    "under until upon used using usually very want wanted well went were what when where whether which " +
    "while will with within without would year years your").split(" ")
);

/** Distinctive tokens with their position in the raw word stream. */
function distinctive(words: string[]): { word: string; at: number }[] {
  const out: { word: string; at: number }[] = [];
  words.forEach((w, at) => {
    if (w.length >= 5 && !COMMON.has(w)) out.push({ word: w, at });
  });
  return out;
}

const NEGATION = /^(didn't|didnt|don't|dont|never|not|wasn't|wasnt|weren't|werent)$/;
/** "I don't think…" is hedging about memory, not retracting a claim. */
const COGNITION = /^(think|thought|know|knew|believe|remember|recall|feel|felt|mean|meant|want|say|said|suppose)$/;
/** Only the candidate talking about themselves can contradict their own claim. */
const SELF = /^(i|we)$/;

/**
 * Look for a real self-contradiction: the candidate negating something they
 * said earlier ABOUT THE SAME THING.
 *
 * The bar is deliberately high. The previous version fired when an answer
 * contained any negation and shared two words longer than five characters with
 * any earlier answer — which, by the third round, matched almost everything. In
 * a live three-persona run every behavioural answer was flagged as
 * contradicting a round-1 answer about arrays: difficulty stayed pinned at 1, a
 * bogus "pin down the contradiction" follow-up fired every turn, and four
 * correct answers were tallied as wrong in the report.
 *
 * A negation governs what FOLLOWS it, so we only look just after the negation:
 * at least two topical words from the same earlier claim, inside a short window
 * starting at the negation — and the negation must be the candidate retracting
 * something about themselves. That catches "I never actually ran Kubernetes in
 * production" against an earlier Kubernetes claim, while ignoring "the script
 * didn't use CONCURRENTLY", "I don't think I said a month", and two long
 * answers that merely both mention the migration.
 */
const WINDOW = 7; // words after a negation that it plausibly governs
const MIN_SHARED = 2;

/**
 * A negation only counts if the candidate is negating something about
 * THEMSELVES — "I didn't lead the migration" retracts a claim, whereas "the
 * script didn't use CONCURRENTLY" is just a new fact that happens to reuse the
 * same nouns. Requiring an "I"/"we" subject and rejecting "I don't think…"
 * removes the bulk of the remaining false positives.
 */
function isSelfRetraction(words: string[], n: number): boolean {
  const subject = words.slice(Math.max(0, n - 2), n).some((w) => SELF.test(w));
  const next = words[n + 1] ?? "";
  return subject && !COGNITION.test(next);
}

function findContradiction(text: string, priorClaims: string[]): string | undefined {
  const words = text.replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
  const negAt = words
    .map((w, i) => (NEGATION.test(w) && isSelfRetraction(words, i) ? i : -1))
    .filter((i) => i >= 0);
  if (negAt.length === 0) return undefined;

  // Newest claims first, and bounded — the claim list grows without limit
  // across a multi-persona session and older rounds matter less.
  for (const claim of priorClaims.slice(-12).reverse()) {
    const theirs = new Set(
      distinctive(claim.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean)).map(
        (d) => d.word
      )
    );
    if (theirs.size === 0) continue;

    for (const n of negAt) {
      const span = words.slice(n + 1, n + 1 + WINDOW);
      const shared = new Set(
        distinctive(span)
          .map((d) => d.word)
          .filter((w) => theirs.has(w))
      );
      if (shared.size >= MIN_SHARED) {
        return `possible contradiction with earlier: "${claim.slice(0, 70)}"`;
      }
    }
  }
  return undefined;
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

  const contradiction = findContradiction(t, priorClaims);
  const contradictory = contradiction !== undefined;
  const note = contradiction;

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
