import { create } from "zustand";
import type { CreateSessionResponse, FinalReport, PersonaId, Turn } from "@knot/shared";
import type { RtcHandle } from "./agora/rtc.js";

type Phase = "setup" | "disclosure" | "live" | "between" | "ended" | "report";

interface State {
  phase: Phase;
  session?: CreateSessionResponse;
  rtc?: RtcHandle;
  round: number;
  persona: PersonaId;
  difficulty: number;
  muted: boolean;
  agentSpeaking: boolean;
  turns: Turn[];
  liveCaption: string;
  report?: FinalReport;
  error?: string;

  set: (p: Partial<State>) => void;
  reset: () => void;
}

const initial = {
  phase: "setup" as Phase,
  round: 0,
  persona: "technical" as PersonaId,
  difficulty: 1,
  muted: false,
  agentSpeaking: false,
  turns: [] as Turn[],
  liveCaption: "",
};

export const useStore = create<State>((set) => ({
  ...initial,
  set: (p) => set(p),
  reset: () => set({ ...initial, session: undefined, rtc: undefined, report: undefined, error: undefined }),
}));
