/**
 * Core domain types shared between the Fastify server and the React web app.
 * Keep this file dependency-free.
 */

export type PersonaId =
  | "technical"
  | "hiring_manager"
  | "customer"
  | "product_manager"
  | "behavioural";

export type Verdict = "right" | "partially_right" | "wrong" | "not_scored";

/** 1 = warm-up, 5 = hardest. The difficulty ladder never jumps more than +1. */
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export interface CandidateProfile {
  name: string;
  /** Free text: role applied for, seniority, stack, notable projects, resume paste. */
  background: string;
  /** Optional: the role/req this interview is for. */
  targetRole?: string;
}

/** One utterance in the interview, as logged by the proxy (source of truth). */
export interface Turn {
  id: string;
  round: number;
  persona: PersonaId;
  role: "interviewer" | "candidate";
  text: string;
  /** Only set on interviewer turns that delivered a verdict about the previous answer. */
  verdictForPrevAnswer?: Verdict;
  /** Difficulty of the question asked in this interviewer turn. */
  difficulty?: DifficultyLevel;
  /** Flags the proxy raised about the candidate's previous answer. */
  flags?: AnswerFlags;
  tsMs: number;
}

export interface AnswerFlags {
  vague?: boolean;
  contradictory?: boolean;
  /** Short machine note, e.g. "contradicts round 1 claim of 3y Kubernetes". */
  note?: string;
}

/** Produced by Claude after a round finishes; the only thing that crosses rounds. */
export interface RoundDigest {
  round: number;
  persona: PersonaId;
  /** 3–6 factual bullets, each grounded in that round's transcript. */
  bullets: string[];
  /** Topics already covered — the next persona is told not to re-ask these. */
  coveredTopics: string[];
  endDifficulty: DifficultyLevel;
}

export interface SessionContext {
  candidate: CandidateProfile;
  currentRound: number;
  currentPersona: PersonaId;
  currentDifficulty: DifficultyLevel;
  /** Personas to run, in order. */
  plan: PersonaId[];
  digests: RoundDigest[];
}

export type SessionStatus =
  | "created"
  | "disclosed"
  | "live"
  | "between_rounds"
  | "ended"
  | "reported";

export interface Session {
  id: string;
  status: SessionStatus;
  channel: string;
  context: SessionContext;
  createdAtMs: number;
  updatedAtMs: number;
  /** Agora Convo AI agent id for the CURRENT round, if an agent is running. */
  agentId?: string;
}

/** Evidence-bound claim in the final report. Every claim must cite a real turn. */
export interface EvidenceClaim {
  statement: string;
  quote: string;
  round: number;
  persona: PersonaId;
  turnId: string;
  /** Set by the verification pass; claims that fail are dropped before render. */
  verified?: boolean;
}

export interface FinalReport {
  sessionId: string;
  candidateName: string;
  overall: string;
  strengths: EvidenceClaim[];
  weaknesses: EvidenceClaim[];
  perRound: {
    round: number;
    persona: PersonaId;
    summary: string;
    verdictTally: Record<Verdict, number>;
  }[];
  /** Claims the model made that failed transcript verification (kept for debugging). */
  droppedUnverifiedClaims: EvidenceClaim[];
  generatedAtMs: number;
}

// ─── HTTP contracts ──────────────────────────────────────────────────────────

export interface CreateSessionRequest {
  candidate: CandidateProfile;
  plan?: PersonaId[];
}

export interface CreateSessionResponse {
  sessionId: string;
  channel: string;
  /** For agora-rtc-sdk-ng client join. */
  rtc: { appId: string; token: string; uid: number };
  plan: PersonaId[];
  disclosureText: string;
}

export interface AdvanceRoundResponse {
  round: number;
  persona: PersonaId;
  handoffLine: string;
  done: boolean;
}
