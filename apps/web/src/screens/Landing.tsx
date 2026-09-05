import { useEffect, useId, useState } from "react";
import { useStore } from "../store.js";
import { api } from "../api.js";
import { joinInterview } from "../agora/rtc.js";
import { PersonaPlan } from "../components/PersonaPlan.js";
import { VoiceInstrument, VoiceStateWord, type VoiceState } from "../components/VoiceInstrument.js";
import { Wordmark } from "../components/KnotMark.js";
import { Button, errorText, Field, TextArea, TextInput } from "../components/ui.js";
import { personaFirstName } from "../design/personas.js";

/**
 * The landing instrument doesn't idle — it plays one exchange on a loop. Amber
 * asks, the machine thinks, teal answers. That single loop teaches the colour
 * code and the turn-taking metaphor before a word of copy has to.
 *
 * The beats are the real rhythm of the live screen, so this is a preview of the
 * orchestrated transition rather than a separate animation.
 */
const EXCHANGE: [VoiceState, number][] = [
  ["speaking", 3400],
  ["thinking", 900],
  ["listening", 3800],
  ["thinking", 700],
];

function useExchangeLoop(): VoiceState {
  const [i, setI] = useState(0);
  const still =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  useEffect(() => {
    if (still) return;
    const t = setTimeout(() => setI((n) => (n + 1) % EXCHANGE.length), EXCHANGE[i][1]);
    return () => clearTimeout(t);
  }, [i, still]);

  // Reduced motion gets one honest frame instead of a loop.
  return still ? "speaking" : EXCHANGE[i][0];
}

/**
 * Pre-flight. Two steps in one room:
 *
 *   1. setup      — who you are, who you want to face
 *   2. disclosure — the consent gate, right before the mic opens
 *
 * The instrument sits idle across the top the whole time, so the object that
 * runs the live screen introduces itself before anything starts.
 */
export function Landing() {
  const phase = useStore((s) => s.phase);
  const demoState = useExchangeLoop();
  return (
    <div className="mx-auto w-full max-w-[1120px] px-5 pb-24 sm:px-8">
      <header className="flex items-center justify-between py-6 sm:py-7">
        <Wordmark />
        <span className="font-measure text-[11px] text-faint">
          {phase === "disclosure" ? "step 2 of 2" : "step 1 of 2"}
        </span>
      </header>

      {/* The hero: the same instrument that runs the live screen, at full size,
          playing one exchange on a loop and narrating itself — so the object the
          product is built on, and the key to its colour system, is the first
          thing you meet. */}
      <div className="mb-12 sm:mb-16">
        <VoiceInstrument state={demoState} half={58} legend />
        <div className="mt-3.5 sm:pl-[6.5rem]">
          <VoiceStateWord state={demoState} />
        </div>
      </div>

      {phase === "disclosure" ? <Consent /> : <Setup />}
    </div>
  );
}

function Setup() {
  const { plan, set } = useStore();
  const [name, setName] = useState("");
  const [background, setBackground] = useState("");
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const bgId = useId();

  const ready = name.trim().length > 0 && background.trim().length > 0;

  async function create() {
    setBusy(true);
    try {
      const session = await api.createSession(
        { name: name.trim(), background: background.trim() },
        plan
      );
      set({ session, phase: "disclosure" });
    } catch (e) {
      set({ error: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) void create();
      }}
    >
      <div className="grid gap-x-16 gap-y-12 lg:grid-cols-12">
        {/* ── Left: what this is, and who you are ── */}
        <div className="lg:col-span-7">
          <h1 className="max-w-[15ch] text-[clamp(2.15rem,6vw,3.4rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-speak">
            Talk your way through a real interview.
          </h1>
          <p className="mt-6 max-w-[52ch] text-[17px] leading-relaxed text-dim">
            Knot.ai runs a spoken interview with a panel of interviewers. It gets harder when
            you&rsquo;re doing well, slows down and pins you when you&rsquo;re vague, and hands
            back to the next interviewer without repeating what the last one already covered.
          </p>
          <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-dim">
            Afterwards it tells you what it heard &mdash; quoting you.
          </p>

          <div className="mt-10 space-y-6">
            <Field label="your name" htmlFor={nameId}>
              <TextInput
                id={nameId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jordan Lee"
                autoComplete="name"
              />
            </Field>

            <Field
              label="background"
              htmlFor={bgId}
              hint="The role you're going for, your stack, and a couple of projects worth asking about. Résumé bullets are fine — the panel reads this before the first question."
            >
              <TextArea
                id={bgId}
                rows={7}
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                placeholder={
                  "Senior backend engineer, 6 years. Go and Postgres.\n" +
                  "Led the payments platform migration — moved 40% of volume\n" +
                  "onto the new ledger before handing off.\n" +
                  "Going for a staff role on a platform team."
                }
              />
            </Field>
          </div>
        </div>

        {/* ── Right: who you'll face, and the honest bits ── */}
        <div className="lg:col-span-5">
          <PersonaPlan plan={plan} onChange={(p) => set({ plan: p })} />

          <div className="mt-10 space-y-5 border-t border-hairline pt-6">
            <Disclosure />
            <p className="text-[13.5px] leading-relaxed text-faint">
              <span className="text-dim">Every claim in your report has to quote you.</span>{" "}
              Anything the model can&rsquo;t point to in the transcript gets dropped before you
              ever see it &mdash; and we&rsquo;ll tell you how many went.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-6">
        <p className="font-measure text-[11.5px] text-faint">
          {plan.map((p) => personaFirstName(p).toLowerCase()).join(" · ")}
        </p>
        <Button type="submit" tone="primary" disabled={!ready || busy}>
          {busy ? "setting up…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}

function Disclosure() {
  return (
    <div className="border-l-2 pl-4" style={{ borderColor: "var(--color-voice-ai)" }}>
      <p className="text-[14px] leading-relaxed text-dim">
        <span className="text-speak">You&rsquo;ll be talking to an AI, not a person.</span> Every
        interviewer on the panel is the same model wearing a different brief.
      </p>
    </div>
  );
}

/* ── Step 2: the consent gate ─────────────────────────────────────────────
   Its own screen rather than a checkbox, because the next click opens the mic.
   ────────────────────────────────────────────────────────────────────────── */

function Consent() {
  const { session, plan, set } = useStore();
  const [busy, setBusy] = useState(false);

  async function accept() {
    if (!session) return;
    setBusy(true);
    // Hand straight to the connecting screen — the mic is really opening now, and
    // that screen is the intentional moment built for exactly this wait.
    set({ phase: "connecting" });
    // The join is often quick; hold the connecting screen long enough that the
    // moment registers rather than flashing past.
    const dwell = new Promise((r) => setTimeout(r, 2100));
    try {
      await api.disclose(session.sessionId);

      const rtc = await joinInterview({
        appId: session.rtc.appId,
        channel: session.channel,
        token: session.rtc.token,
        uid: session.rtc.uid,
        onCaption: (c) =>
          useStore.setState({
            liveCaption: c.isFinal
              ? ""
              : `${c.speaker === "candidate" ? "You" : "Interviewer"}: ${c.text}`,
          }),
        onAgentAudioState: (speaking) => useStore.setState({ agentSpeaking: speaking }),
        onError: (e) => console.warn("rtc", e),
      });

      const first = await api.start(session.sessionId);
      await dwell;
      set({
        rtc,
        phase: "live",
        round: first.round,
        persona: first.persona,
        difficulty: 1,
        startedAtMs: Date.now(),
      });
    } catch (e) {
      // Don't strand the candidate on the connecting screen — drop back to the
      // consent gate with the error, so "start" is right there to retry.
      set({ error: errorText(e), phase: "disclosure" });
    } finally {
      setBusy(false);
    }
  }

  const rounds = session?.plan ?? plan;

  return (
    <div className="max-w-[62ch]">
      <h1 className="text-[clamp(1.9rem,5vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-speak">
        Before the mic opens.
      </h1>

      <div
        className="mt-8 border-l-2 pl-5 text-[16px] leading-relaxed text-dim"
        style={{ borderColor: "var(--color-voice-ai)" }}
      >
        {session?.disclosureText}
      </div>

      <dl className="mt-10 space-y-4 border-t border-hairline pt-6">
        {[
          [
            "microphone",
            "Your mic goes live and stays live. The conversation is transcribed as you speak.",
          ],
          [
            "interrupting",
            "Talk over the interviewer whenever you want — it stops and listens, like a person would.",
          ],
          [
            "leaving",
            "End the session at any point. You'll still get the report for whatever you covered.",
          ],
          [
            "the panel",
            `${rounds.length} ${rounds.length === 1 ? "round" : "rounds"}: ${rounds
              .map((p) => personaFirstName(p))
              .join(", then ")}.`,
          ],
        ].map(([term, def]) => (
          <div key={term} className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:gap-6">
            <dt className="font-measure text-[11.5px] text-faint sm:pt-1">{term}</dt>
            <dd className="text-[15px] leading-relaxed text-dim">{def}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
        <Button tone="primary" disabled={busy} onClick={accept}>
          {busy ? "connecting…" : "I understand — start"}
        </Button>
        <Button onClick={() => useStore.setState({ phase: "setup" })} disabled={busy}>
          Back
        </Button>
      </div>
    </div>
  );
}
