import type { Turn } from "@knot/shared";
import { PERSONA_HUE, personaFirstName } from "../design/personas.js";

/**
 * The session spine — the live instrument, compressed.
 *
 * The same two-channel shape that ran the interview, squeezed into one picture
 * of the whole thing: interviewer turns above the line, yours below it, each
 * block as wide as the turn was long. It is the third and last appearance of the
 * one object the design is built on.
 *
 * Everything here comes from the real transcript. There is no per-second audio
 * in a finished report, so the spine measures what actually exists — how many
 * turns, whose, how long, in which round — rather than drawing a waveform it
 * would have to invent.
 */

const BLOCK = 26;

export function SessionSpine({ turns }: { turns: Turn[] }) {
  if (turns.length === 0) return null;

  // Character count stands in for speaking time. It's a proxy, and the caption
  // says so — but it's a proxy built from real data rather than a decoration.
  const weight = (t: Turn) => Math.max(24, t.text.length);
  const rounds = [...new Set(turns.map((t) => t.round))].map((round) => {
    const inRound = turns.filter((t) => t.round === round);
    return {
      round,
      turns: inRound,
      hue: PERSONA_HUE[inRound[0].persona],
      name: personaFirstName(inRound[0].persona).toLowerCase(),
      weight: inRound.reduce((n, t) => n + weight(t), 0),
    };
  });

  return (
    <figure className="m-0">
      {/* The axis runs unbroken under every round — it's the same baseline the
          live instrument draws, and both channels hang off it. */}
      <div className="relative" aria-hidden="true">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-faint" />
        <div className="relative flex items-stretch gap-4">
          {rounds.map((r) => (
            <div key={r.round} className="flex min-w-0 gap-[2px]" style={{ flex: r.weight }}>
              {r.turns.map((t) => (
                <span key={t.id} className="min-w-0" style={{ flex: weight(t) }}>
                  <span
                    className="block rounded-t-[1px]"
                    style={{
                      height: BLOCK,
                      background: t.role === "interviewer" ? r.hue : "transparent",
                    }}
                  />
                  {/* The axis runs through this gap, so leave it clear. */}
                  <span className="block" style={{ height: 3 }} />
                  <span
                    className="block rounded-b-[1px]"
                    style={{
                      height: BLOCK,
                      background:
                        t.role === "candidate" ? "var(--color-voice-you)" : "transparent",
                    }}
                  />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Round labels, on the same weights as the blocks above them. */}
      <div className="mt-2.5 flex gap-4">
        {rounds.map((r) => (
          <p
            key={r.round}
            className="font-measure min-w-0 truncate text-[10.5px]"
            style={{ flex: r.weight, color: r.hue }}
          >
            {r.round}. {r.name}
          </p>
        ))}
      </div>

      <figcaption className="font-measure mt-3 text-[10.5px] leading-relaxed text-faint">
        Every turn in the session. Above the line is the interviewer, below is you; block
        width is how long the turn ran.
      </figcaption>
    </figure>
  );
}
