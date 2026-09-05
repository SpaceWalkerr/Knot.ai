import { useEffect, useRef } from "react";
import type { Turn } from "@knot/shared";
import { PERSONA_HUE, personaFirstName, personaRole } from "../design/personas.js";
import { VerdictChip } from "./ui.js";

/**
 * The transcript, set the way a published interview is set: the speaker's name
 * in a left gutter, their words in serif beside it, a hairline between turns.
 *
 * Deliberately not chat bubbles. Bubbles say "texting"; this is a spoken
 * interview being recorded, and the typography should say so.
 */
export function TranscriptPanel({
  turns,
  liveCaption,
  className,
}: {
  turns: Turn[];
  liveCaption: string;
  className?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const landed = useRef(false);

  // Open on the newest turn. Mid-session the interesting end of the transcript
  // is the bottom, and a reader who wants round 1 can scroll up to it.
  useEffect(() => {
    if (landed.current || turns.length === 0) return;
    landed.current = true;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length]);

  // Follow the conversation, but only when the reader is already at the bottom —
  // yanking the view away while they're scrolled back reading an earlier answer
  // is the worst thing a live transcript can do.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (nearBottom) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, liveCaption]);

  return (
    <div
      ref={scrollRef}
      className={`overflow-y-auto ${className ?? ""}`}
      role="log"
      aria-label="Interview transcript"
    >
      {turns.length === 0 && !liveCaption && (
        <p className="py-8 text-[15px] text-faint">
          Nothing said yet. The first question is on its way.
        </p>
      )}

      {turns.map((t, i) => (
        <div key={t.id}>
          {/* A persona handoff is a real event in this product — mark it. */}
          {t.round !== turns[i - 1]?.round && i > 0 && <RoundBreak turn={t} />}
          <TurnRow turn={t} />
        </div>
      ))}

      {liveCaption && <PartialRow text={liveCaption} />}
      <div ref={endRef} />
    </div>
  );
}

function speakerOf(turn: Turn) {
  if (turn.role === "candidate") {
    return { name: "You", hue: "var(--color-voice-you)" };
  }
  return { name: personaFirstName(turn.persona), hue: PERSONA_HUE[turn.persona] };
}

function TurnRow({ turn }: { turn: Turn }) {
  const { name, hue } = speakerOf(turn);
  const verdict = turn.verdictForPrevAnswer;
  const flags = [
    turn.flags?.vague && "pinning down a vague answer",
    turn.flags?.contradictory && "checking a contradiction",
  ].filter(Boolean) as string[];

  return (
    <article className="grid gap-1 border-b border-hairline py-4 sm:grid-cols-[6.5rem_1fr] sm:gap-6 sm:py-5">
      <h3
        className="font-measure text-[12px] leading-[1.7] sm:pt-[3px] sm:text-right"
        style={{ color: hue }}
      >
        {name}
      </h3>

      <div className="min-w-0">
        {(verdict && verdict !== "not_scored") || flags.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            {verdict && verdict !== "not_scored" && <VerdictChip verdict={verdict} />}
            {flags.map((f) => (
              <span key={f} className="font-measure text-[10.5px] text-verdict-partial/85">
                {f}
              </span>
            ))}
          </div>
        ) : null}

        <p className="text-[15.5px] leading-[1.62] text-speak">{turn.text}</p>
      </div>
    </article>
  );
}

/** The interviewer changed. Worth a line of its own. */
function RoundBreak({ turn }: { turn: Turn }) {
  const hue = PERSONA_HUE[turn.persona];
  return (
    <div className="flex items-center gap-3 py-6">
      <span className="h-px flex-1 bg-hairline" />
      <span className="font-measure text-[11px]" style={{ color: hue }}>
        round {turn.round} — {personaFirstName(turn.persona).toLowerCase()},{" "}
        {personaRole(turn.persona).toLowerCase()}
      </span>
      <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}

/** Agora's partial captions, before the proxy has logged the turn. */
function PartialRow({ text }: { text: string }) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[6.5rem_1fr] sm:gap-6 sm:py-5">
      <p className="font-measure text-[12px] leading-[1.7] text-faint sm:pt-[3px] sm:text-right">
        live
      </p>
      <p className="text-[15.5px] italic leading-[1.62] text-dim">{text}</p>
    </div>
  );
}
