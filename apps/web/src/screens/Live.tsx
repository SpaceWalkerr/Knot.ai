import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { api } from "../api.js";
import { TranscriptPanel } from "../components/TranscriptPanel.js";
import { VoiceInstrument, VoiceStateWord, type VoiceState } from "../components/VoiceInstrument.js";
import { Wordmark } from "../components/KnotMark.js";
import { Button, DifficultyLadder, errorText } from "../components/ui.js";
import { PERSONA_HUE, personaFirstName, personaRole } from "../design/personas.js";

/**
 * The live interview. One instrument, four states, and the transcript building
 * underneath it.
 *
 * The voice state is derived here rather than stored per-frame: the instrument
 * pulls raw levels itself at animation rate, while this only writes to the store
 * when the state actually CHANGES, so a whole turn of speech is one re-render
 * instead of sixty a second.
 */
export function Live() {
  const s = useStore();
  const set = s.set;
  const hue = PERSONA_HUE[s.persona];
  const isLast = s.session ? s.round >= s.session.plan.length : true;

  useVoiceStateMachine();
  const elapsed = useElapsed(s.startedAtMs);

  // Poll the server transcript (source of truth) while live / between rounds.
  useEffect(() => {
    if (!s.session || s.demo) return;
    if (s.phase === "ended" || s.phase === "report") return;
    const id = s.session.sessionId;
    const t = setInterval(async () => {
      try {
        const d = await api.transcript(id);
        useStore.setState({
          turns: d.turns,
          difficulty: d.difficulty,
          persona: d.persona,
          round: d.round,
        });
      } catch {
        /* ignore transient */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [s.session, s.phase, s.demo]);

  async function nextRound() {
    if (!s.session) return;
    set({ phase: "between" });
    try {
      const r = await api.nextRound(s.session.sessionId);
      if (r.done) await endAndReport();
      else set({ phase: "live", round: r.round, persona: r.persona });
    } catch (e) {
      set({ error: errorText(e) });
    }
  }

  async function endAndReport() {
    if (!s.session) return;
    set({ phase: "ended" });
    try {
      await s.rtc?.leave();
      await api.end(s.session.sessionId);
      const report = await api.generateReport(s.session.sessionId);
      set({ report, phase: "report" });
    } catch (e) {
      set({ error: errorText(e) });
    }
  }

  const status =
    s.phase === "between"
      ? "Handing over to the next interviewer."
      : s.phase === "ended"
        ? "Reading the transcript back and writing your report."
        : s.muted
          ? "Your mic is off. Nothing you say is reaching the interviewer."
          : "Speak naturally. Interrupt whenever you want.";

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[1000px] flex-col overflow-hidden px-5 sm:px-8">
      {/* ── Instrument bar: everything the machine is counting ── */}
      <header className="-mx-5 flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-hairline px-5 py-3.5 sm:-mx-8 sm:px-8">
        <Wordmark />

        <span className="font-measure flex items-center gap-2 text-[11.5px] text-dim">
          {/* The lamp carries the voice state too — amber when the interviewer
              talks, teal when you do, violet while the model works. */}
          <span
            className={`h-[7px] w-[7px] rounded-full transition-colors duration-[420ms] ${
              s.voiceState === "muted" ? "" : "anim-pulse"
            }`}
            style={{ background: LAMP[s.voiceState] }}
            aria-hidden="true"
          />
          live
        </span>

        <span className="font-measure text-[11.5px] text-dim">
          round {s.round}
          {s.session ? ` / ${s.session.plan.length}` : ""}
        </span>

        <DifficultyLadder level={s.difficulty} tint={hue} />

        <span className="flex-1" />

        <span className="font-measure text-[11.5px] text-faint" aria-label="Elapsed time">
          {elapsed}
        </span>
      </header>

      {/* ── The hero: who's on, the instrument, the state ── */}
      <section className="shrink-0 py-7 sm:py-9">
        <div className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1
            className="text-[clamp(1.6rem,4.5vw,2.25rem)] font-semibold leading-none tracking-[-0.015em] transition-colors duration-[420ms]"
            style={{ color: s.voiceState === "speaking" ? hue : "var(--color-speak)" }}
          >
            {personaFirstName(s.persona)}
          </h1>
          <p className="font-measure text-[12px] text-faint">{personaRole(s.persona).toLowerCase()}</p>
        </div>

        <VoiceInstrument
          state={s.voiceState}
          levels={s.rtc?.getLevels}
          half={76}
          legend
          className="mb-4"
        />

        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 sm:pl-[6.5rem]">
          <VoiceStateWord state={s.voiceState} subject={personaFirstName(s.persona)} />
          <p className="text-[13.5px] text-faint">{status}</p>
        </div>
      </section>

      {/* ── The record, building as you talk ── */}
      <TranscriptPanel
        turns={s.turns}
        liveCaption={s.liveCaption}
        className="min-h-0 flex-1 border-t border-hairline"
      />

      {/* ── Controls. Fixed on mobile so "end" is always in reach ── */}
      <footer className="-mx-5 flex shrink-0 flex-wrap items-center gap-2 border-t border-hairline px-5 py-3.5 sm:-mx-8 sm:px-8">
        <Button
          onClick={() => {
            const m = !s.muted;
            s.rtc?.setMuted(m);
            set({ muted: m });
          }}
          aria-pressed={s.muted}
        >
          {s.muted ? "Unmute mic" : "Mute mic"}
        </Button>
        <span className="flex-1" />
        {!isLast && (
          <Button onClick={nextRound} disabled={s.phase !== "live"}>
            Next round
          </Button>
        )}
        <Button tone="primary" onClick={endAndReport} disabled={s.phase === "ended"}>
          {s.phase === "ended" ? "Writing report…" : "End & get report"}
        </Button>
      </footer>
    </div>
  );
}

const LAMP: Record<VoiceState, string> = {
  speaking: "var(--color-voice-ai)",
  listening: "var(--color-voice-you)",
  thinking: "var(--color-voice-think)",
  idle: "var(--color-faint)",
  muted: "var(--color-faint)",
};

/* ── Deriving the voice state ─────────────────────────────────────────────
   Agora gives us "the agent is publishing audio" and a mic level. Turning that
   into the four states the UI shows is this hook's whole job.
   ────────────────────────────────────────────────────────────────────────── */

function useVoiceStateMachine() {
  const lastYou = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      const { muted, agentSpeaking, rtc, voiceState, phase, demo } = useStore.getState();
      if (demo) return; // the demo harness scripts the states itself

      let next: VoiceState;
      const now = Date.now();
      const you = rtc?.getLevels?.().you ?? 0;
      if (you > 0.06) lastYou.current = now;

      if (muted) next = "muted";
      else if (agentSpeaking) next = "speaking";
      // Hold "listening" through the natural pauses inside a sentence, or the
      // instrument flickers between states every time you draw breath.
      else if (now - lastYou.current < 1200) next = "listening";
      else if (phase === "live" || phase === "between") next = "thinking";
      else next = "idle";

      if (next !== voiceState) useStore.setState({ voiceState: next });
    }, 100);
    return () => clearInterval(id);
  }, []);
}

function useElapsed(startedAtMs?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAtMs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAtMs]);

  if (!startedAtMs) return "0:00";
  const secs = Math.max(0, Math.floor((now - startedAtMs) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
