import { useEffect, useRef, useState } from "react";

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
  const [width, setWidth] = useState(640);

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
    for (let i = 0; i < n; i++) {
      const x = (i * step + step / 2).toFixed(1);
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
    }
    aiPath.current?.setAttribute("d", dAi);
    youPath.current?.setAttribute("d", dYou);
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

  const channel = (
    kind: "ai" | "you",
    ref: React.RefObject<SVGPathElement>,
    lit: boolean
  ) => (
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
      <path
        ref={ref}
        stroke={kind === "ai" ? "var(--color-voice-ai)" : "var(--color-voice-you)"}
        strokeWidth={Math.max(2, width / Math.max(1, bars) - 2)}
        strokeLinecap="butt"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );

  const instrument = (
    <div ref={hostRef} className="min-w-0 flex-1">
      {channel("ai", aiPath, aiLit)}

      {/* The baseline — where the two channels meet, and what silence looks
          like. Every turn handoff crosses here, and the thinking pulse travels
          along it. */}
      {/* 3px tall so the thinking pulse has something to travel through; the
          line itself stays 1px, centred. */}
      <div className="relative my-[2px] h-[3px] w-full overflow-hidden">
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
        {state === "thinking" && (
          <div
            className="anim-traverse absolute inset-y-0 w-1/3"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--color-voice-think), transparent)",
            }}
          />
        )}
      </div>

      {channel("you", youPath, youLit)}
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
