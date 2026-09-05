import { create } from "zustand";
import type { CreateSessionResponse, FinalReport, PersonaId, Turn } from "@knot/shared";
import { DEFAULT_PLAN } from "@knot/shared";
import type { RtcHandle } from "./agora/rtc.js";
import type { VoiceState } from "./components/VoiceInstrument.js";

type Phase = "setup" | "disclosure" | "live" | "between" | "ended" | "report";

interface State {
  phase: Phase;
  session?: CreateSessionResponse;
  rtc?: RtcHandle;
  /** The panel the candidate picked on the landing screen, in order. */
  plan: PersonaId[];
  round: number;
  persona: PersonaId;
  difficulty: number;
  muted: boolean;
  agentSpeaking: boolean;
  /** Derived at ~10Hz from mic + agent levels; drives the voice instrument. */
  voiceState: VoiceState;
  startedAtMs?: number;
  turns: Turn[];
  liveCaption: string;
  report?: FinalReport;
  error?: string;
  /** True when the screen is being driven by the dev-only demo harness. */
  demo: boolean;

  set: (p: Partial<State>) => void;
  reset: () => void;
}

const initial = {
  phase: "setup" as Phase,
  plan: [...DEFAULT_PLAN],
  round: 0,
  persona: "technical" as PersonaId,
  difficulty: 1,
  muted: false,
  agentSpeaking: false,
  voiceState: "idle" as VoiceState,
  turns: [] as Turn[],
  liveCaption: "",
  demo: false,
};

export const useStore = create<State>((set) => ({
  ...initial,
  set: (p) => set(p),
  reset: () =>
    set({
      ...initial,
      session: undefined,
      rtc: undefined,
      report: undefined,
      error: undefined,
      startedAtMs: undefined,
    }),
}));
