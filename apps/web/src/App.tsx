import { useEffect, useState } from "react";
import { PERSONAS, DEFAULT_PLAN } from "@knot/shared";
import { useStore } from "./store.js";
import { api } from "./api.js";
import { joinInterview } from "./agora/rtc.js";
import { TranscriptPanel } from "./components/TranscriptPanel.js";
import { ReportView } from "./components/ReportView.js";

export function App() {
  const s = useStore();

  return (
    <div className="wrap">
      <div className="eyebrow">Knot.ai · adaptive multi-persona voice interview</div>
      {s.error && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <span style={{ color: "var(--danger)" }}>{s.error}</span>
        </div>
      )}
      {s.phase === "setup" && <Setup />}
      {s.phase === "disclosure" && <Disclosure />}
      {(s.phase === "live" || s.phase === "between" || s.phase === "ended") && <Live />}
      {s.phase === "report" && s.report && <ReportView report={s.report} />}
    </div>
  );
}

function Setup() {
  const set = useStore((z) => z.set);
  const [name, setName] = useState("");
  const [background, setBackground] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const session = await api.createSession({ name, background }, DEFAULT_PLAN);
      set({ session, phase: "disclosure" });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h1>Start an interview</h1>
      <label className="muted">Candidate name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" />
      <div style={{ height: 12 }} />
      <label className="muted">
        Background — role applied for, seniority, stack, notable projects (paste résumé bullets)
      </label>
      <textarea
        rows={6}
        value={background}
        onChange={(e) => setBackground(e.target.value)}
        placeholder="Senior backend engineer, 6y. Go + Postgres. Led payments platform migration…"
      />
      <div style={{ height: 14 }} />
      <div className="row">
        <span className="muted">
          Rounds: {DEFAULT_PLAN.map((p) => PERSONAS[p].label).join(" → ")}
        </span>
        <span className="spacer" />
        <button className="primary" disabled={!name || !background || busy} onClick={create}>
          {busy ? "Creating…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function Disclosure() {
  const { session, set } = useStore();
  const [busy, setBusy] = useState(false);

  async function accept() {
    if (!session) return;
    setBusy(true);
    try {
      await api.disclose(session.sessionId);

      const rtc = await joinInterview({
        appId: session.rtc.appId,
        channel: session.channel,
        token: session.rtc.token,
        uid: session.rtc.uid,
        onCaption: (c) =>
          useStore.setState({
            liveCaption: c.isFinal ? "" : `${c.speaker === "candidate" ? "You" : "Interviewer"}: ${c.text}`,
          }),
        onAgentAudioState: (speaking) => useStore.setState({ agentSpeaking: speaking }),
        onError: (e) => console.warn("rtc", e),
      });

      const first = await api.start(session.sessionId);
      set({
        rtc,
        phase: "live",
        round: first.round,
        persona: first.persona,
        difficulty: 1,
      });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h1>Before we start</h1>
      <div className="disclosure">
        {session?.disclosureText}
        <br />
        <br />
        Your microphone will be used and the conversation transcribed. You can interrupt the
        interviewer at any time and end the session whenever you like.
      </div>
      <div style={{ height: 14 }} />
      <div className="row">
        <span className="spacer" />
        <button className="primary" disabled={busy} onClick={accept}>
          {busy ? "Connecting…" : "I understand — begin"}
        </button>
      </div>
    </div>
  );
}

function Live() {
  const s = useStore();
  const set = s.set;

  // Poll the server transcript (source of truth) while live / between rounds.
  useEffect(() => {
    if (!s.session) return;
    if (s.phase === "ended" || s.phase === "report") return;
    const id = s.session.sessionId;
    const t = setInterval(async () => {
      try {
        const d = await api.transcript(id);
        useStore.setState({ turns: d.turns, difficulty: d.difficulty, persona: d.persona, round: d.round });
      } catch {
        /* ignore transient */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [s.session, s.phase]);

  const persona = PERSONAS[s.persona];
  const isLast = s.session ? s.round >= s.session.plan.length : true;

  async function nextRound() {
    if (!s.session) return;
    set({ phase: "between" });
    try {
      const r = await api.nextRound(s.session.sessionId);
      if (r.done) {
        await endAndReport();
      } else {
        set({ phase: "live", round: r.round, persona: r.persona });
      }
    } catch (e) {
      set({ error: String(e) });
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
      set({ error: String(e) });
    }
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="badge" style={{ borderColor: `var(${persona.colorVar})` }}>
          <span className="dot" style={{ background: `var(${persona.colorVar})` }} />
          {persona.displayName}
        </span>
        <span className="badge">
          Round {s.round}
          {s.session ? ` / ${s.session.plan.length}` : ""}
        </span>
        <span className="badge">
          Difficulty
          <span className="difficulty-meter" style={{ marginLeft: 6 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={n <= s.difficulty ? "on" : ""} />
            ))}
          </span>
        </span>
        {s.agentSpeaking && <span className="badge">🔊 interviewer speaking</span>}
        <span className="spacer" />
        <button
          onClick={() => {
            const m = !s.muted;
            s.rtc?.setMuted(m);
            set({ muted: m });
          }}
        >
          {s.muted ? "Unmute mic" : "Mute mic"}
        </button>
      </div>

      <TranscriptPanel turns={s.turns} liveCaption={s.liveCaption} />

      <div className="row">
        <span className="muted">
          {s.phase === "between"
            ? "Handing over to the next interviewer…"
            : s.phase === "ended"
            ? "Generating your grounded assessment…"
            : "Speak naturally. Interrupt any time."}
        </span>
        <span className="spacer" />
        {!isLast && (
          <button onClick={nextRound} disabled={s.phase !== "live"}>
            Next round →
          </button>
        )}
        <button className="primary" onClick={endAndReport} disabled={s.phase === "ended"}>
          End & get report
        </button>
      </div>
    </div>
  );
}
