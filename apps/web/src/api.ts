import type {
  AdvanceRoundResponse,
  CandidateProfile,
  CreateSessionResponse,
  FinalReport,
  PersonaId,
  Turn,
} from "@knot/shared";

// In dev, Vite proxies /api to the Fastify server (see vite.config.ts).
// In prod, set VITE_SERVER_URL to the deployed server origin.
const base = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  createSession: (candidate: CandidateProfile, plan?: PersonaId[]) =>
    fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate, plan }),
    }).then((r) => j<CreateSessionResponse>(r)),

  disclose: (id: string) =>
    fetch(`${base}/api/session/${id}/disclose`, { method: "POST" }).then(j),

  start: (id: string) =>
    fetch(`${base}/api/session/${id}/start`, { method: "POST" }).then((r) =>
      j<{ round: number; persona: PersonaId; handoffLine: string }>(r)
    ),

  nextRound: (id: string) =>
    fetch(`${base}/api/session/${id}/round/next`, { method: "POST" }).then((r) =>
      j<AdvanceRoundResponse>(r)
    ),

  end: (id: string) =>
    fetch(`${base}/api/session/${id}/end`, { method: "POST" }).then(j),

  generateReport: (id: string) =>
    fetch(`${base}/api/session/${id}/report`, { method: "POST" }).then((r) =>
      j<FinalReport>(r)
    ),

  transcript: (id: string) =>
    fetch(`${base}/api/session/${id}/transcript`).then((r) =>
      j<{
        status: string;
        round: number;
        persona: PersonaId;
        difficulty: number;
        turns: Turn[];
      }>(r)
    ),
};
