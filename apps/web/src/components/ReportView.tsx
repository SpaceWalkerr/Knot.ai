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
          <h1 className="text-[clamp(2rem,5.5vw,3rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
            {report.candidateName}
          </h1>
          <p className="font-measure mt-2 text-[12px] text-dim">
            assessment · {report.perRound.length}{" "}
            {report.perRound.length === 1 ? "round" : "rounds"}
            {turns.length > 0 && ` · ${turns.length} turns · ~${minutes} min`}
          </p>
        </div>

        {turns.length > 0 && (
          <div className="mt-9">
            <SessionSpine turns={turns} />
          </div>
        )}

        {/* ── Overall ── */}
        <section className="mt-12">
          <SectionRule>overall</SectionRule>
          <p className="mt-5 max-w-[62ch] text-[18px] leading-[1.62]">{report.overall}</p>
        </section>

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
