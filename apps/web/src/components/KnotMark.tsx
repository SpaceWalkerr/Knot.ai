/**
 * The mark: two strands crossing. Amber is the interviewer's voice, teal is
 * yours — the same two colours that drive the waveform, tied in the one place
 * the name comes from.
 */
export function KnotMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M2.5 6.5C6.5 6.5 8 13.5 12 13.5C15 13.5 16.5 11.5 17.5 10"
        stroke="var(--color-voice-ai)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M2.5 13.5C6.5 13.5 8 6.5 12 6.5C15 6.5 16.5 8.5 17.5 10"
        stroke="var(--color-voice-you)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <KnotMark />
      <span className="font-measure text-[14px] text-speak">
        knot<span className="text-faint">.ai</span>
      </span>
    </span>
  );
}
