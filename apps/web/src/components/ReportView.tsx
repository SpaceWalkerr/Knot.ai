import type { EvidenceClaim, FinalReport, Verdict } from "@knot/shared";
import { useStore } from "../store.js";
import { SessionSpine } from "./SessionSpine.js";
import { Wordmark } from "./KnotMark.js";
import { Button, SectionRule } from "./ui.js";
import { PERSONA_HUE, personaFirstName, personaRole } from "../design/personas.js";

/**
 * The report.
 *
 * This is the one screen that leaves the dark instrument behind and becomes a
 * light document — the live session is something you're inside, the assessment
 * is something you keep. `data-surface="paper"` flips the six surface tokens; no
 * component below here knows or cares which environment it's in.
 *
 * The structural rule: a claim cannot render without its quote. Evidence isn't
 * supporting detail underneath a conclusion, it's part of the same object.
 */
export function ReportView({ report }: { report: FinalReport }) {
  const turns = useStore((s) => s.turns);
  const minutes = Math.max(1, Math.round((report.generatedAtMs - (turns[0]?.tsMs ?? 0)) / 60000));

  // The read: the first sentence of the overall carries the thesis, so it's
  // lifted out as the one thing the candidate sees first — set large — and the
  // rest stays below as the supporting prose.
  const m = report.overall.match(/^(.*?[.!?])\s+([\s\S]*)$/);
  const lede = m ? m[1] : report.overall;
  const rest = m ? m[2] : "";

  // The shape of the session: every scored answer, aggregated into one bar. It's
  // the report's one loud use of colour — the verdict palette at full strength.
  const tally = report.perRound.reduce(
    (acc, r) => ({
      right: acc.right + (r.verdictTally.right ?? 0),
      partially_right: acc.partially_right + (r.verdictTally.partially_right ?? 0),
      wrong: acc.wrong + (r.verdictTally.wrong ?? 0),
    }),
    { right: 0, partially_right: 0, wrong: 0 }
  );
  const scored = tally.right + tally.partially_right + tally.wrong;

  return (
    <div data-surface="paper" className="min-h-dvh bg-ground text-speak">
      <header className="mx-auto flex w-full max-w-[880px] items-center justify-between px-5 py-5 sm:px-8">
        <Wordmark />
        <Button size="sm" onClick={() => window.print()}>
          Save as PDF
        </Button>
      </header>

      <main className="mx-auto w-full max-w-[880px] px-5 pb-24 sm:px-8">
        {/* ── Masthead ── */}
        <div className="border-t border-edge pt-8">
          <p className="font-measure text-[12px] text-dim">
            assessment · {report.candidateName.toLowerCase()}
          </p>
          <h1 className="mt-1 text-[clamp(1.7rem,4.4vw,2.6rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
            {report.candidateName}
          </h1>
        </div>

        {/* ── The read: the one thing, first ── */}
        <p className="mt-7 max-w-[26ch] text-[clamp(1.5rem,3.4vw,2.15rem)] font-normal leading-[1.28] tracking-[-0.01em] text-speak">
          {lede}
        </p>

        {/* ── The shape of the session ── */}
        {scored > 0 && <VerdictShape tally={tally} total={scored} />}

        <p className="font-measure mt-6 text-[12px] text-dim">
          {report.perRound.length} {report.perRound.length === 1 ? "round" : "rounds"}
          {turns.length > 0 && ` · ${turns.length} turns · ~${minutes} min`}
        </p>

        {turns.length > 0 && (
          <div className="mt-10">
            <SessionSpine turns={turns} />
          </div>
        )}

        {/* ── Overall ── */}
        {rest && (
          <section className="mt-14">
            <SectionRule>the rest of it</SectionRule>
            <p className="mt-5 max-w-[62ch] text-[18px] leading-[1.62]">{rest}</p>
          </section>
        )}

        {/* ── The evidence ── */}
        <section className="mt-14 grid gap-10 md:grid-cols-2 md:gap-12">
          <div>
            <SectionRule tint="var(--color-verdict-right)">strengths</SectionRule>
            <ClaimList claims={report.strengths} tint="var(--color-verdict-right)" />
          </div>
          <div>
            <SectionRule tint="var(--color-verdict-wrong)">needs work</SectionRule>
            <ClaimList claims={report.weaknesses} tint="var(--color-verdict-wrong)" />
          </div>
        </section>

        {/* ── Round by round ── */}
        <section className="mt-14">
          <SectionRule>round by round</SectionRule>
          <div className="mt-2">
            {report.perRound.map((r) => {
              const hue = PERSONA_HUE[r.persona];
              return (
                <article
                  key={r.round}
                  className="grid gap-2 border-b border-hairline py-6 sm:grid-cols-[10rem_1fr] sm:gap-8"
                >
                  <div>
                    <p className="font-measure text-[12px]" style={{ color: hue }}>
                      {r.round}. {personaFirstName(r.persona).toLowerCase()}
                    </p>
                    <p className="font-measure mt-1 text-[11px] text-faint">
                      {personaRole(r.persona).toLowerCase()}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="max-w-[58ch] text-[15.5px] leading-[1.6] text-dim">
                      {r.summary}
                    </p>
                    <Tally tally={r.verdictTally} />
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* ── The honesty note. Promoted, not buried. ── */}
        {report.droppedUnverifiedClaims.length > 0 && (
          <section className="mt-14">
            <SectionRule tint="var(--color-voice-think)">what we cut</SectionRule>
            <p className="mt-5 max-w-[62ch] text-[15.5px] leading-[1.6] text-dim">
              <strong className="font-semibold text-speak">
                {report.droppedUnverifiedClaims.length}{" "}
                {report.droppedUnverifiedClaims.length === 1 ? "claim" : "claims"} were removed
                from this report
              </strong>{" "}
              because the model couldn&rsquo;t point to where you said it. They aren&rsquo;t
              findings about you — they&rsquo;re the guardrail doing its job, listed so you can
              see what it caught.
            </p>
            <ul className="mt-6 space-y-4">
              {report.droppedUnverifiedClaims.map((c, i) => (
                <li
                  key={i}
                  className="border-l-2 pl-4 text-[14px] leading-snug text-faint"
                  style={{ borderColor: "var(--color-voice-think)" }}
                >
                  <span className="line-through decoration-1">{c.statement}</span>
                  <span className="font-measure mt-1 block text-[10.5px]">
                    no matching turn in the transcript
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

/* ── A claim, bound to its evidence ───────────────────────────────────────
   The quote is not optional decoration under the statement — it's the second
   half of the component. If a claim ever arrived without one it would render as
   visibly incomplete, which is the correct outcome.
   ────────────────────────────────────────────────────────────────────────── */

function ClaimList({ claims, tint }: { claims: EvidenceClaim[]; tint: string }) {
  if (claims.length === 0) {
    return (
      <p className="mt-5 text-[15px] leading-relaxed text-faint">
        Nothing here the transcript could back up. That usually means the session was short
        rather than that there was nothing to say.
      </p>
    );
  }

  return (
    <ul className="mt-5 space-y-7">
      {claims.map((c, i) => (
        <li key={i}>
          <p className="text-[16px] leading-[1.5] text-speak">{c.statement}</p>
          <blockquote
            className="mt-2.5 border-l-2 pl-4"
            style={{ borderColor: tint }}
          >
            <p className="text-[15px] italic leading-[1.55] text-dim">
              &ldquo;{c.quote}&rdquo;
            </p>
            <cite className="font-measure mt-1.5 block text-[10.5px] not-italic text-faint">
              round {c.round} · {personaFirstName(c.persona).toLowerCase()}
            </cite>
          </blockquote>
        </li>
      ))}
    </ul>
  );
}

const TALLY_TINT: Record<Verdict, string> = {
  right: "var(--color-verdict-right)",
  partially_right: "var(--color-verdict-partial)",
  wrong: "var(--color-verdict-wrong)",
  not_scored: "var(--color-faint)",
};

/* ── The shape of the session ─────────────────────────────────────────────
   One bar, every scored answer, in proportion. This is the report's single
   loudest moment — the verdict palette at full strength — and the fastest read
   on the page: you see the balance of the session before you read a word of it.
   ────────────────────────────────────────────────────────────────────────── */

function VerdictShape({
  tally,
  total,
}: {
  tally: { right: number; partially_right: number; wrong: number };
  total: number;
}) {
  const seg: [Verdict, number, string][] = [
    ["right", tally.right, "right"],
    ["partially_right", tally.partially_right, "partly"],
    ["wrong", tally.wrong, "not right"],
  ];
  return (
    <div className="mt-8">
      <div
        className="flex h-3.5 w-full max-w-[440px] gap-[3px]"
        role="img"
        aria-label={seg.map(([, n, label]) => `${n} ${label}`).join(", ")}
      >
        {seg.map(([k, n]) =>
          n > 0 ? (
            <span
              key={k}
              className="rounded-[2px]"
              style={{ flex: n, background: TALLY_TINT[k] }}
            />
          ) : null
        )}
      </div>
      <div className="font-measure mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px]">
        {seg.map(([k, n, label]) => (
          <span key={k} className="inline-flex items-center gap-1.5" style={{ color: TALLY_TINT[k] }}>
            <span
              className="h-[7px] w-[7px] rounded-[1px]"
              style={{ background: TALLY_TINT[k] }}
              aria-hidden="true"
            />
            {n} {label}
          </span>
        ))}
        <span className="text-faint">· {total} answers scored</span>
      </div>
    </div>
  );
}

function Tally({ tally }: { tally: Record<Verdict, number> }) {
  const rows: [Verdict, string][] = [
    ["right", "right"],
    ["partially_right", "partly"],
    ["wrong", "not right"],
  ];
  return (
    <p className="font-measure mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
      {rows.map(([k, label]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span
            className="h-[7px] w-[7px] rounded-[1px]"
            style={{ background: TALLY_TINT[k] }}
            aria-hidden="true"
          />
          {tally[k] ?? 0} {label}
        </span>
      ))}
    </p>
  );
}
