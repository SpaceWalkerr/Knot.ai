import { useEffect, useId, useRef, useState } from "react";

/**
 * The dual-channel voice instrument — the one object the whole design is built
 * on. The interviewer's channel sits above a shared baseline, yours below it.
 * Whoever is talking has amplitude; the other side goes flat.
 *
 * It shows up three times in the product, in three sizes: playing one exchange
 * on the landing screen, as the hero of the live screen, and compressed into
 * the session spine on the report.
 *
 * All four live states are readable from colour and shape alone:
 *
 *   speaking   amber rises above the line, your side flat        (interviewer talks)
 *   listening  teal falls below the line, amber holds a breath   (you talk)
 *   thinking   both flat, a violet pulse crosses the baseline    (machine works)
 *   muted      both flat and desaturated, baseline goes dashed   (mic off)
 *
 * Silence is the baseline itself — a quiet channel draws nothing, so the line
 * you see between turns is the literal absence of sound rather than a decorative
 * rule.
 *
 * Each channel is ONE svg path whose `d` is rebuilt per frame, not a few hundred
 * divs: two attribute writes a frame regardless of how many bars are on screen.
 *
 * Amplitude comes from real audio when it's available (Agora exposes
 * `getVolumeLevel()` on both the local mic and the remote agent track). Without
 * it the component synthesises a plausible speech envelope gated by the state,
 * so the instrument is never lying about *who* is talking — only about the
 * exact shape of the sound.
 */

export type VoiceState = "idle" | "speaking" | "listening" | "thinking" | "muted";

export interface VoiceInstrumentProps {
  state: VoiceState;
  /** Live levels, 0..1. Omit either channel to synthesise it. */
  levels?: () => { ai?: number; you?: number };
  /** Pixel height of each half of the instrument. */
  half?: number;
  /** Show the channel key — which side is the interviewer, which side is you. */
  legend?: boolean;
  className?: string;
}

const HISTORY = 200; // samples retained
const WINDOW = 140; // samples SHOWN — a fixed slice of time, whatever the width
const DT = 1 / 60; // seconds per sample — one per animation frame
const PITCH = 7; // px per bar: narrow enough that a quiet channel never reads as a dash

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** A speech-like envelope: syllable rate with a slower phrase contour on top. */
function synthEnvelope(t: number, seed: number) {
  const syllable = 0.5 + 0.5 * Math.sin(t * 11 + seed);
  const phrase = 0.55 + 0.45 * Math.sin(t * 1.7 + seed * 2.3);
  const grain = 0.85 + 0.15 * Math.sin(t * 37 + seed * 5);
  // Held just under full scale: a waveform that pegs at the top reads as
  // clipped audio rather than as a loud voice.
  return Math.max(0, syllable * phrase * grain * 0.9);
}

/** The level each channel should be at, for a given state and moment. */
function targets(state: VoiceState, t: number): { ai: number; you: number } {
  switch (state) {
    case "speaking":
      return { ai: synthEnvelope(t, 0.4), you: 0 };
    case "listening":
      // The interviewer holds a breath while it listens — attentive, not dead.
      return { ai: 0.05 + 0.035 * Math.sin(t * 2.2), you: synthEnvelope(t, 2.1) };
    case "idle": {
      // An open mic in a quiet room still shows room tone.
      const room = (seed: number) =>
        0.14 + 0.08 * Math.sin(t * 1.3 + seed) + 0.06 * Math.sin(t * 6.9 + seed * 3);
      return { ai: room(0), you: room(1.9) };
    }
    default:
      return { ai: 0, you: 0 }; // thinking, muted
  }
}

export function VoiceInstrument({
  state,
  levels,
  half = 96,
  legend = false,
  className,
}: VoiceInstrumentProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const aiPath = useRef<SVGPathElement>(null);
  const youPath = useRef<SVGPathElement>(null);
  // The bars carry the reading; a filled envelope under them carries the mass,
  // so a voice looks like a body of sound instead of a row of ticks.
  const aiArea = useRef<SVGPathElement>(null);
  const youArea = useRef<SVGPathElement>(null);
  const [width, setWidth] = useState(640);

  // Filters and gradients are referenced by url(#id); the instrument mounts more
  // than once on a page (landing loop, live hero), so the ids must be unique per
  // instance or every copy inherits the first one's bloom.
  const rawId = useId();
  const uid = rawId.replace(/:/g, "_");

  const stateRef = useRef(state);
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  const buf = useRef({
    ai: new Array<number>(HISTORY).fill(0),
    you: new Array<number>(HISTORY).fill(0),
  });

  const bars = Math.max(20, Math.min(WINDOW, Math.floor(width / PITCH)));

  // The animation loop mounts once and keeps the same `paint` closure for the
  // life of the component, so geometry has to reach it through refs. Reading
  // `width` directly meant it drew forever at the pre-measure default.
  const widthRef = useRef(width);
  widthRef.current = width;
  // A phone can't spare 150px of vertical for the instrument, and a silent
  // channel would eat most of it. Scale the whole thing down on narrow screens.
  const h = width < 480 ? Math.round(half * 0.68) : half;
  const halfRef = useRef(h);
  halfRef.current = h;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(([entry]) => {
      // A 2px deadband: the exact width jitters as scrollbars and fonts settle,
      // and there is no reason to redraw for a fraction of a bar.
      setWidth((cur) => {
        const next = Math.round(entry.contentRect.width);
        return Math.abs(next - cur) > 2 ? next : cur;
      });
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  /**
   * Seed the whole history from the synth whenever the state changes and there
   * is no live audio to draw from. Without this the instrument spends its first
   * few seconds in every state looking like silence while the buffer trickles
   * in from the right — which is exactly the moment the user is looking at it.
   */
  useEffect(() => {
    stateRef.current = state;
    if (levelsRef.current) return; // real audio fills honestly, from the right
    const now = performance.now() / 1000;
    const ai: number[] = [];
    const you: number[] = [];
    for (let i = 0; i < HISTORY; i++) {
      const t = now - (HISTORY - 1 - i) * DT;
      const v = targets(state, t);
      ai.push(v.ai);
      you.push(v.you);
    }
    buf.current = { ai, you };
  }, [state]);

  /** Rebuild each channel's path: one vertical segment per bar. */
  const paint = () => {
    const { ai, you } = buf.current;
    const w = widthRef.current;
    const h = halfRef.current;
    const n = Math.max(20, Math.min(WINDOW, Math.floor(w / PITCH)));
    const step = w / n;
    const start = HISTORY - WINDOW;
    const per = WINDOW / n;

    // A phone shows fewer bars, but it must still show the same SPAN OF TIME —
    // otherwise a narrow screen zooms into a fraction of a second and the
    // waveform collapses into a solid block. Each bar is the peak of its
    // bucket, so sub-sampling never quietly drops a syllable.
    let dAi = "";
    let dYou = "";
    // The envelope traces every tip — silent buckets sit it back on the baseline,
    // loud ones swell it up — then closes along the baseline into a fillable area.
    let aAi = `M0 ${h}`;
    let aYou = "M0 0";
    for (let i = 0; i < n; i++) {
      const cx = i * step + step / 2;
      const x = cx.toFixed(1);
      const lo = start + Math.floor(i * per);
      const hi = start + Math.floor((i + 1) * per);
      let a = 0;
      let y = 0;
      for (let j = lo; j < hi; j++) {
        if (ai[j] > a) a = ai[j];
        if (you[j] > y) y = you[j];
      }
      // Sub-pixel bars are noise; silence is carried by the baseline instead.
      if (a > 0.005) dAi += `M${x} ${h}V${(h - a * h).toFixed(1)}`;
      if (y > 0.005) dYou += `M${x} 0V${(y * h).toFixed(1)}`;
      aAi += `L${x} ${(h - a * h).toFixed(1)}`;
      aYou += `L${x} ${(y * h).toFixed(1)}`;
    }
    aAi += `L${w} ${h}Z`;
    aYou += `L${w} 0Z`;
    aiPath.current?.setAttribute("d", dAi);
    youPath.current?.setAttribute("d", dYou);
    aiArea.current?.setAttribute("d", aAi);
    youArea.current?.setAttribute("d", aYou);
  };

  // Reduced motion: paint a single static frame per state and stop. Colour,
  // shape and the state word still carry the full meaning, so nothing that
  // means anything is animation-dependent.
  useEffect(() => {
    if (!prefersReducedMotion()) return;
    const ai: number[] = [];
    const you: number[] = [];
    for (let i = 0; i < HISTORY; i++) {
      const v = targets(state, i * DT * 6);
      ai.push(v.ai);
      you.push(v.you);
    }
    buf.current = { ai, you };
    paint();
  });

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let raf = 0;
    let aiSmooth = 0;
    let youSmooth = 0;
    const t0 = performance.now();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const t = (now - t0) / 1000;
      const want = targets(stateRef.current, now / 1000);
      const live = levelsRef.current?.();

      // Attack fast, release slow — how a real level meter behaves.
      const ease = (cur: number, next: number) =>
        cur + (next - cur) * (next > cur ? 0.5 : 0.16);
      const gate = stateRef.current;
      aiSmooth = ease(aiSmooth, gate === "speaking" ? (live?.ai ?? want.ai) : want.ai);
      youSmooth = ease(youSmooth, gate === "listening" ? (live?.you ?? want.you) : want.you);
      void t;

      const { ai, you } = buf.current;
      ai.shift();
      ai.push(aiSmooth);
      you.shift();
      you.push(youSmooth);
      paint();
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Repaint immediately on resize so the picture doesn't wait for the next frame.
  useEffect(paint, [width, h]);

  const aiLit = state === "speaking";
  const youLit = state === "listening";
  const opacity = (lit: boolean) =>
    state === "muted" ? 0.25 : state === "idle" ? 0.6 : lit ? 1 : 0.34;

  // The bloom scales with the instrument, so the 42px landing loop glows softly
  // and the 76px live hero glows like it means it.
  const bloom = Math.max(1.4, h / 20);

  /**
   * The handoff beat — the one orchestrated moment. When the turn actually
   * changes hands (into speaking or listening), a bright hairline of the new
   * voice's colour sweeps once across the baseline. Keyed on a counter so each
   * genuine handoff re-fires the single sweep; nothing animates on the many
   * sub-second flickers the state machine smooths over.
   */
  const [beat, setBeat] = useState<{ k: number; color: string } | null>(null);
  const prevState = useRef(state);
  useEffect(() => {
    const from = prevState.current;
    prevState.current = state;
    if (prefersReducedMotion()) return;
    if ((state === "speaking" || state === "listening") && from !== state) {
      setBeat({
        k: Date.now(),
        color: state === "speaking" ? "var(--color-voice-ai)" : "var(--color-voice-you)",
      });
    }
  }, [state]);

  const channel = (
    kind: "ai" | "you",
    barRef: React.RefObject<SVGPathElement>,
    areaRef: React.RefObject<SVGPathElement>,
    lit: boolean
  ) => {
    const color = kind === "ai" ? "var(--color-voice-ai)" : "var(--color-voice-you)";
    const barId = `${uid}-${kind}-bars`;
    const gradId = `${uid}-${kind}-fill`;
    const glowId = `${uid}-${kind}-glow`;
    const sw = Math.max(2, width / Math.max(1, bars) - 2);
    return (
      <svg
        width="100%"
        height={h}
        viewBox={`0 0 ${Math.max(1, width)} ${h}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="block"
        style={{
          opacity: opacity(lit),
          transition: "opacity 420ms var(--ease-settle)",
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1={kind === "ai" ? "1" : "0"} x2="0" y2={kind === "ai" ? "0" : "1"}>
            <stop offset="0" stopColor={color} stopOpacity="0" />
            <stop offset="1" stopColor={color} stopOpacity={lit ? 0.26 : 0.14} />
          </linearGradient>
          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={bloom} />
          </filter>
        </defs>

        {/* Mass: the filled envelope under the bars. */}
        <path ref={areaRef} fill={`url(#${gradId})`} stroke="none" />

        {/* Bloom: the same bars, blurred and re-laid behind, so the voice reads
            as light rather than ink. Only the active channel is worth the glow. */}
        {lit && (
          <use
            href={`#${barId}`}
            filter={`url(#${glowId})`}
            style={{ opacity: 0.9 }}
          />
        )}

        {/* The reading itself — crisp, measured, on top. */}
        <path
          id={barId}
          ref={barRef}
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  };

  const instrument = (
    <div ref={hostRef} className="relative min-w-0 flex-1">
      {channel("ai", aiPath, aiArea, aiLit)}

      {/* The baseline — where the two channels meet, and what silence looks
          like. The line itself stays 1px, centred in a 3px strip. */}
      <div className="relative my-[2px] h-[3px] w-full">
        <div
          className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
          style={{
            background:
              state === "muted"
                ? "repeating-linear-gradient(90deg, var(--color-edge) 0 4px, transparent 4px 9px)"
                : "var(--color-edge)",
            transition: "background 420ms var(--ease-settle)",
          }}
        />
      </div>

      {channel("you", youPath, youArea, youLit)}

      {/* Thinking, the signature: a violet thought running through a braid of the
          two voices, laid over the whole instrument so it has room to weave. */}
      {state === "thinking" && <ThinkingWeave width={width} h={h} />}

      {/* The handoff beat: one bright sweep in the new voice's colour, centred on
          the baseline, each time the turn actually changes hands. */}
      {beat && (
        <div
          className="pointer-events-none absolute inset-x-0 overflow-hidden"
          style={{ top: h - 2, height: 11 }}
          aria-hidden="true"
        >
          <div
            key={beat.k}
            className="anim-handoff absolute inset-y-0 w-2/5"
            style={{
              background: `linear-gradient(90deg, transparent, ${beat.color}, transparent)`,
              filter: "blur(0.4px)",
            }}
          />
        </div>
      )}
    </div>
  );

  if (!legend) return <div className={className}>{instrument}</div>;

  // With the legend on, the instrument stops being a picture and becomes the key
  // to the whole colour system: amber above the line is the interviewer, teal
  // below it is you. Every other screen assumes you have read this once.
  return (
    <div className={`flex items-stretch gap-4 sm:gap-5 ${className ?? ""}`}>
      <div className="font-measure hidden w-[5.5rem] shrink-0 flex-col text-right text-[10.5px] leading-none sm:flex">
        <span
          className="flex items-end justify-end pb-1.5"
          style={{ height: h, color: "var(--color-voice-ai)" }}
        >
          interviewer
        </span>
        <span className="my-[3px] h-px" aria-hidden="true" />
        <span
          className="flex items-start justify-end pt-1.5"
          style={{ height: h, color: "var(--color-voice-you)" }}
        >
          you
        </span>
      </div>
      {instrument}
    </div>
  );
}

/* ── The thinking signature ───────────────────────────────────────────────
   Two strands — amber above the baseline, teal below — braid together while the
   model works, and a violet node of thought travels through the weave. It's the
   knot in the name, drawn for the one state where neither voice is talking: the
   machine holding both sides in mind. Nothing here is load-bearing — the state
   word and the violet colour still say "thinking" on their own — so it degrades
   to a static braid under reduced motion.
   ────────────────────────────────────────────────────────────────────────── */

const LAMBDA = 88; // wavelength; must match the knot-weave keyframe's translate

function weaveD(w: number, cy: number, amp: number, dir: 1 | -1) {
  const end = w + 2 * LAMBDA;
  const stepX = LAMBDA / 14;
  let d = "";
  for (let x = 0; x <= end; x += stepX) {
    const y = cy + dir * amp * Math.sin((2 * Math.PI * x) / LAMBDA);
    d += `${x === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

function ThinkingWeave({ width, h }: { width: number; h: number }) {
  const still = prefersReducedMotion();
  const w = Math.max(1, width);
  const fullH = 2 * h + 7; // ai + strip + you, matching the instrument stack
  const cy = h + 3.5; // the baseline's centre within that stack
  const amp = Math.min(13, h * 0.2);
  const think = "var(--color-voice-think)";

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg
        width={w}
        height={fullH}
        viewBox={`0 0 ${w} ${fullH}`}
        className="absolute inset-0"
        style={{ overflow: "hidden" }}
      >
        {/* The braid is drawn two wavelengths wide and slid by exactly one, so
            the weave flows seamlessly. Both strands ride one <g> so they move as
            one cloth. */}
        <g className={still ? undefined : "anim-weave"}>
          <path
            d={weaveD(w, cy, amp, -1)}
            stroke="var(--color-voice-ai)"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            style={{ opacity: 0.55 }}
          />
          <path
            d={weaveD(w, cy, amp, 1)}
            stroke="var(--color-voice-you)"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            style={{ opacity: 0.55 }}
          />
        </g>
      </svg>

      {/* The thought itself, travelling through the braid with a soft violet
          bloom. Held out under reduced motion, where the static braid carries
          the meaning instead. */}
      {!still && (
        <div
          className="anim-comet absolute"
          style={{
            top: cy,
            width: Math.round(h * 0.9),
            height: Math.round(h * 0.9),
            transform: "translate(-50%, -50%)",
            borderRadius: "999px",
            background: `radial-gradient(circle, ${think} 0%, color-mix(in oklab, ${think} 45%, transparent) 35%, transparent 70%)`,
          }}
        />
      )}
    </div>
  );
}

/* ── The state word ───────────────────────────────────────────────────────
   Deliberately separate from the instrument so it can be placed differently on
   each screen. It is the text half of the state; the waveform is the visual
   half, and neither is load-bearing on its own.
   ────────────────────────────────────────────────────────────────────────── */

const STATE_COPY: Record<VoiceState, { word: string; tint: string }> = {
  speaking: { word: "speaking", tint: "var(--color-voice-ai)" },
  listening: { word: "listening", tint: "var(--color-voice-you)" },
  thinking: { word: "thinking", tint: "var(--color-voice-think)" },
  muted: { word: "mic off", tint: "var(--color-faint)" },
  idle: { word: "ready", tint: "var(--color-faint)" },
};

export function VoiceStateWord({
  state,
  subject,
  className,
}: {
  state: VoiceState;
  /** Who the state is about, e.g. "Marcus". Omitted on the landing screen. */
  subject?: string;
  className?: string;
}) {
  const { word, tint } = STATE_COPY[state];
  return (
    <p
      role="status"
      className={`font-measure text-[12.5px] transition-colors duration-[420ms] ${className ?? ""}`}
      style={{ color: tint, transitionTimingFunction: "var(--ease-settle)" }}
    >
      {subject && state !== "muted" && <span className="text-faint">{subject} is </span>}
      {word}
    </p>
  );
}
