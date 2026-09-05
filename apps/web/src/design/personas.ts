import type { PersonaId } from "@knot/shared";
import { PERSONAS } from "@knot/shared";

/**
 * UI-side persona presentation.
 *
 * `packages/shared` stays framework- and style-free (the Fastify server imports
 * it), so anything visual lives here.
 *
 * Persona hues are used for identity only — a dot, a rule, a citation. They are
 * never used as a waveform channel colour, so "amber = the interviewer is
 * speaking" holds no matter who is asking.
 */
export const PERSONA_HUE: Record<PersonaId, string> = {
  technical: "var(--color-persona-technical)",
  hiring_manager: "var(--color-persona-hiring)",
  customer: "var(--color-persona-customer)",
  product_manager: "var(--color-persona-product)",
  behavioural: "var(--color-persona-behavioural)",
};

/** First name only — how the persona is addressed mid-interview. */
export function personaFirstName(id: PersonaId): string {
  return PERSONAS[id]?.displayName.split(" ")[0] ?? "Interviewer";
}

/** "Technical", "Hiring Manager" — the role, without the name. */
export function personaRole(id: PersonaId): string {
  return PERSONAS[id]?.label.replace(/ Interviewer$/, "") ?? id;
}

/**
 * One plain line describing what this persona is actually digging for. Written
 * for the candidate, second person — the `focus` field in shared is written for
 * the model and reads like a spec.
 */
export const PERSONA_PITCH: Record<PersonaId, string> = {
  technical:
    "Fundamentals, a system design scenario, and a broken-in-production story. Expect pushback if you hand-wave.",
  hiring_manager:
    "What you actually owned, how you handle ambiguity, and where a disagreement went. Says “we” back to you as “you”.",
  customer:
    "Explain your work without jargon to someone who doesn't have it. Gets lost on purpose and tells you so.",
  product_manager:
    "Cut a feature that won't ship on time, then defend the call. Wants a decision, not options.",
  behavioural:
    "Real stories with real outcomes — a conflict, a failure, hard feedback. Redirects hypotheticals back to what happened.",
};
