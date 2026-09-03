import { useEffect, useRef } from "react";
import type { Turn } from "@knot/shared";
import { PERSONAS } from "@knot/shared";

export function TranscriptPanel({
  turns,
  liveCaption,
}: {
  turns: Turn[];
  liveCaption: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, liveCaption]);

  return (
    <div className="card" style={{ maxHeight: 420, overflowY: "auto" }}>
      {turns.length === 0 && !liveCaption && (
        <p className="muted">Transcript will appear here as you talk.</p>
      )}
      {turns.map((t) => (
        <div className="turn" key={t.id}>
          <div className="who">
            {t.role === "interviewer"
              ? PERSONAS[t.persona]?.displayName ?? "Interviewer"
              : "You"}
            {t.verdictForPrevAnswer && t.verdictForPrevAnswer !== "not_scored" && (
              <span className={`verdict ${t.verdictForPrevAnswer}`} style={{ marginLeft: 8 }}>
                {t.verdictForPrevAnswer.replace("_", " ")}
              </span>
            )}
            {t.flags?.vague && <span className="flag">flagged vague</span>}
            {t.flags?.contradictory && <span className="flag">flagged contradiction</span>}
          </div>
          <div className="text">{t.text}</div>
        </div>
      ))}
      {liveCaption && (
        <div className="turn" style={{ opacity: 0.6 }}>
          <div className="who">…live</div>
          <div className="text">{liveCaption}</div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
