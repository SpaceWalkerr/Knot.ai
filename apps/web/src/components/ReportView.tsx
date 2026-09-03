import type { EvidenceClaim, FinalReport } from "@knot/shared";
import { PERSONAS } from "@knot/shared";

function ClaimList({ claims }: { claims: EvidenceClaim[] }) {
  if (claims.length === 0) return <p className="muted">Insufficient evidence in the transcript.</p>;
  return (
    <>
      {claims.map((c, i) => (
        <div className="claim" key={i}>
          <div>{c.statement}</div>
          <div className="q">
            “{c.quote}” — round {c.round}, {PERSONAS[c.persona]?.label ?? c.persona}
          </div>
        </div>
      ))}
    </>
  );
}

export function ReportView({ report }: { report: FinalReport }) {
  return (
    <div>
      <div className="eyebrow">Final assessment · evidence-grounded</div>
      <h1>{report.candidateName}</h1>

      <div className="card">
        <strong>Overall</strong>
        <p style={{ lineHeight: 1.6 }}>{report.overall}</p>
      </div>

      <div className="card">
        <strong style={{ color: "var(--ok)" }}>Strengths</strong>
        <ClaimList claims={report.strengths} />
      </div>

      <div className="card">
        <strong style={{ color: "var(--danger)" }}>Weaknesses</strong>
        <ClaimList claims={report.weaknesses} />
      </div>

      <div className="card">
        <strong>By round</strong>
        {report.perRound.map((r) => (
          <div className="claim" key={r.round}>
            <div>
              Round {r.round} — {PERSONAS[r.persona]?.label ?? r.persona}
            </div>
            <div className="q">{r.summary}</div>
            <div className="muted">
              right {r.verdictTally.right} · partial {r.verdictTally.partially_right} · wrong{" "}
              {r.verdictTally.wrong}
            </div>
          </div>
        ))}
      </div>

      {report.droppedUnverifiedClaims.length > 0 && (
        <div className="card">
          <span className="muted">
            {report.droppedUnverifiedClaims.length} model claim(s) were dropped for failing
            transcript verification (grounding guardrail working).
          </span>
        </div>
      )}
    </div>
  );
}
