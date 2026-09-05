import { useEffect } from "react";
import { useStore } from "./store.js";
import { Landing } from "./screens/Landing.js";
import { Live } from "./screens/Live.js";
import { Connecting } from "./components/Connecting.js";
import { ReportView } from "./components/ReportView.js";
import { Button } from "./components/ui.js";

export function App() {
  const phase = useStore((s) => s.phase);
  const report = useStore((s) => s.report);
  const error = useStore((s) => s.error);

  // The demo harness is dev-only, so it is imported dynamically: with the gate
  // statically false in a production build the chunk is emitted but never
  // fetched, which keeps the fake transcript out of the shipped bundle.
  useEffect(() => {
    if (!import.meta.env.DEV && import.meta.env.VITE_DEMO !== "1") return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("./demo.js").then((m) => {
      if (!cancelled) stop = m.startDemo();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <>
      {error && <ErrorBar message={error} />}
      {(phase === "setup" || phase === "disclosure") && <Landing />}
      {phase === "connecting" && <Connecting />}
      {(phase === "live" || phase === "between" || phase === "ended") && <Live />}
      {phase === "report" && report && <ReportView report={report} />}
    </>
  );
}

/**
 * Errors are the one place the interview can dead-end, so they get a bar that
 * spans the screen rather than a tinted card that scrolls away.
 *
 * Sticky, and opaque rather than a 10% tint. It sits at the top of the document,
 * but errors are raised from buttons at the BOTTOM of a scrolled page — as a
 * static translucent bar it rendered ~100px above the viewport, so a candidate
 * whose microphone failed saw nothing happen at all.
 */
function ErrorBar({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="sticky top-0 z-50 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-verdict-wrong/40 px-5 py-3 sm:px-8"
      style={{
        background: "color-mix(in oklab, var(--color-verdict-wrong) 14%, var(--color-graphite-950))",
      }}
    >
      <p className="min-w-0 flex-1 text-[14px] text-verdict-wrong">{message}</p>
      <Button size="sm" onClick={() => useStore.setState({ error: undefined })}>
        Dismiss
      </Button>
    </div>
  );
}
