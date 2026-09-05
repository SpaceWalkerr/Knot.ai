import { useEffect, useState } from "react";
import { useStore } from "../store.js";
import { VoiceInstrument } from "./VoiceInstrument.js";
import { Wordmark } from "./KnotMark.js";
import { PERSONA_HUE, personaFirstName, personaRole } from "../design/personas.js";

/**
 * The connecting screen — "tuning the room".
 *
 * In most products the gap between "start" and the first question is a spinner,
 * or nothing. Here the mic is genuinely opening (Agora join, then the server's
 * first turn), which is the perfect cover for one intentional moment: the same
 * instrument that will run the interview wakes up on room tone, and the panel
 * arrives one interviewer at a time in the order they'll come.
 *
 * The instrument sits in `idle`, so it's the real object breathing — not a
 * loading graphic pretending to be one. The screen is purely presentational;
 * the actual join runs in `Consent`, which flips the phase to `live` the moment
 * the first question lands.
 */

const STEPS = ["opening the microphone", "briefing the panel", "ready when you are"];

export function Connecting() {
  const plan = useStore((s) => s.session?.plan ?? s.plan);
  const [step, setStep] = useState(0);

  // Walk the status line forward and hold on the last line until the join
  // completes and the phase changes out from under us.
  useEffect(() => {
    const still =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (still) {
      setStep(STEPS.length - 1);
      return;
    }
    const t = setInterval(() => setStep((n) => Math.min(n + 1, STEPS.length - 1)), 1100);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col px-5 sm:px-8">
      <header className="flex items-center justify-between py-6 sm:py-7">
        <Wordmark />
        <span className="font-measure text-[11px] text-faint">connecting</span>
      </header>

      <div className="flex flex-1 flex-col justify-center pb-24">
        <p className="font-measure text-[12px] text-voice-think" role="status">
          {STEPS[step]}
          <span aria-hidden="true" className="anim-pulse">
            {" "}
            …
          </span>
        </p>

        <h1 className="mt-3 text-[clamp(1.9rem,5vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.02em] text-speak">
          Tuning the room.
        </h1>

        {/* The instrument, awake on room tone — the object itself, warming up. */}
        <VoiceInstrument state="idle" half={64} legend className="mt-10" />

        {/* The panel, arriving in order. */}
        <ol className="mt-12 space-y-px border-t border-hairline pt-6">
          {plan.map((id, i) => {
            const hue = PERSONA_HUE[id];
            return (
              <li
                key={id}
                className="anim-rise flex items-center gap-3.5 py-2"
                style={{ animationDelay: `${240 + i * 260}ms` }}
              >
                <span
                  className="font-measure grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] leading-none"
                  style={{ background: hue, color: "var(--color-graphite-975)" }}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="text-[16px] text-speak">{personaFirstName(id)}</span>
                <span className="font-measure text-[11px]" style={{ color: hue }}>
                  {personaRole(id).toLowerCase()}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
