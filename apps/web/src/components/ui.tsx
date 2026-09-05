import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Verdict } from "@knot/shared";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/** Message text for the error bar. `String(err)` leaks a bare "Error:" prefix. */
export function errorText(e: unknown): string {
  const raw =
    e && typeof e === "object" && "message" in e ? String((e as Error).message) : String(e);
  return raw.replace(/^Error:\s*/, "");
}

/* ── Button ────────────────────────────────────────────────────────────────
   Controls are machine surface, so they're mono. Squared to 3px rather than
   pill-rounded: this is an instrument panel, not a marketing page. No arrows.
   ────────────────────────────────────────────────────────────────────────── */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "ghost" | "danger";
  size?: "md" | "sm";
};

export function Button({ tone = "ghost", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        "font-measure inline-flex items-center justify-center gap-2 rounded-[3px]",
        "border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "px-3 py-1.5 text-[12px]" : "px-4 py-2.5 text-[13px]",
        tone === "primary" &&
          "border-transparent bg-voice-you text-graphite-975 font-medium hover:bg-voice-you/85",
        tone === "ghost" &&
          "border-edge bg-transparent text-speak hover:border-dim hover:bg-speak/[0.06]",
        tone === "danger" &&
          "border-verdict-wrong/50 bg-transparent text-verdict-wrong hover:bg-verdict-wrong/10",
        className
      )}
    />
  );
}

/* ── Field ────────────────────────────────────────────────────────────────
   Label is mono (the form is machine intake); the value you type is serif,
   because it's your words.
   ────────────────────────────────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="font-measure block text-[12px] text-dim">
        {label}
      </label>
      {hint && <p className="mt-1 text-[13px] leading-snug text-faint">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

// No `focus:outline-none` here. Tailwind's outline-none sets --tw-outline-style
// to none, which then silently disables any focus-visible:outline-* that tries to
// put the ring back. The one global :focus-visible rule in theme.css owns the
// ring; this only changes the border, which is what mouse focus gets.
const fieldBase =
  "w-full rounded-[3px] border border-hairline bg-graphite-950 px-3.5 py-3 " +
  "text-[15px] text-speak placeholder:text-faint/70 " +
  "transition-colors duration-150 hover:border-edge focus:border-voice-you";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldBase, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldBase, "leading-relaxed", props.className)} />;
}

/* ── Difficulty ladder ────────────────────────────────────────────────────
   Five rungs, 1 = warm-up. A measurement, so mono label + hard-edged segments
   rather than a smooth progress bar — the ladder is discrete by design and the
   UI should say so.
   ────────────────────────────────────────────────────────────────────────── */

export function DifficultyLadder({
  level,
  tint = "var(--color-voice-ai)",
  compact = false,
}: {
  level: number;
  tint?: string;
  compact?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-2"
      role="img"
      aria-label={`Difficulty ${level} of 5`}
    >
      {!compact && <span className="font-measure text-[11px] text-faint">difficulty</span>}
      <span className="flex items-end gap-[3px]" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className="w-[6px] rounded-[1px] transition-all duration-300"
            style={{
              height: 5 + n * 2,
              background: n <= level ? tint : "var(--color-hairline)",
            }}
          />
        ))}
      </span>
    </span>
  );
}

/* ── Verdict chip ─────────────────────────────────────────────────────────── */

const VERDICT_LABEL: Record<Verdict, string> = {
  right: "right",
  partially_right: "partly right",
  wrong: "not right",
  not_scored: "unscored",
};

const VERDICT_TINT: Record<Verdict, string> = {
  right: "var(--color-verdict-right)",
  partially_right: "var(--color-verdict-partial)",
  wrong: "var(--color-verdict-wrong)",
  not_scored: "var(--color-faint)",
};

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const tint = VERDICT_TINT[verdict];
  return (
    <span
      className="font-measure inline-flex shrink-0 items-center rounded-[2px] px-1.5 py-0.5 text-[10.5px] leading-[1.5]"
      style={{
        color: tint,
        background: `color-mix(in oklab, ${tint} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tint} 30%, transparent)`,
      }}
    >
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

/* ── Section rule ─────────────────────────────────────────────────────────
   A heading followed by a hairline that fills the remaining width. Used instead
   of card borders to separate report sections — keeps the page reading as one
   document rather than a stack of tiles.
   ────────────────────────────────────────────────────────────────────────── */

export function SectionRule({ children, tint }: { children: ReactNode; tint?: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <h2
        className="font-measure shrink-0 text-[12px] tracking-[0.02em]"
        style={{ color: tint ?? "var(--color-dim)" }}
      >
        {children}
      </h2>
      <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}
