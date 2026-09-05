import type { FinalReport, PersonaId, Turn } from "@knot/shared";
import { AI_DISCLOSURE_TEXT } from "@knot/shared";
import { useStore } from "./store.js";
import type { VoiceState } from "./components/VoiceInstrument.js";

/**
 * Dev-only demo harness.
 *
 * The live voice loop needs Agora minutes and a working mic, which makes the
 * most important screen in the product the hardest one to look at. This seeds
 * the store with a realistic session so the live and report screens can be
 * opened, designed against, and shown — without burning a session.
 *
 * Enabled only in `vite dev`, or in a build made with VITE_DEMO=1. It can never
 * be switched on by URL alone in a normal production build.
 *
 *   /?demo=live     the interview in progress, cycling through voice states
 *   /?demo=consent  the disclosure gate, without creating a session
 *   /?demo=report   the finished assessment
 *
 * There is also a real-data mode, which renders the actual screens against a
 * session that already exists on the server — useful for checking the UI
 * against real payloads rather than fixtures, and for reopening a past report:
 *
 *   /?demo=session&id=<sessionId>              the stored report
 *   /?demo=session&id=<sessionId>&screen=live  the live screen, real transcript
 *
 * Add &state=speaking|listening|thinking|muted to pin the live instrument.
 */
const t0 = Date.now() - 11 * 60 * 1000;
let n = 0;
const turn = (
  round: number,
  persona: PersonaId,
  role: Turn["role"],
  text: string,
  extra: Partial<Turn> = {}
): Turn => ({
  id: `demo-${++n}`,
  round,
  persona,
  role,
  text,
  tsMs: t0 + n * 42_000,
  ...extra,
});

/**
 * A real-shaped transcript: an easy opener, a right answer, an escalation, a
 * vague answer that gets pinned, a recovery, then a persona handoff where the
 * hiring manager digs "we" out of the candidate's answer.
 */
export const DEMO_TURNS: Turn[] = [
  turn(
    1,
    "technical",
    "interviewer",
    "Let's start easy. You mentioned a payments ledger in Postgres — walk me through how you'd model double-entry. What tables, and what stops the two sides drifting apart?",
    { difficulty: 1 }
  ),
  turn(
    1,
    "technical",
    "candidate",
    "An accounts table and an entries table. Every transaction writes at least two rows — a debit and a credit — sharing a transaction_id, and the invariant is that the entries for a transaction_id sum to zero. I'd enforce that with a deferred constraint so both sides land in the same transaction."
  ),
  turn(
    1,
    "technical",
    "interviewer",
    "That's right, and the deferred constraint is the part most people skip. Harder one: you're at four thousand writes a second and that check is now your bottleneck. What changes?",
    { verdictForPrevAnswer: "right", difficulty: 2 }
  ),
  turn(
    1,
    "technical",
    "candidate",
    "Honestly at that point I'd look at scaling the database out. Sharding, probably, or moving to something with better write throughput."
  ),
  turn(
    1,
    "technical",
    "interviewer",
    "That's too general for me. Shard on what column? And tell me what breaks the first time a transfer crosses two shards.",
    {
      verdictForPrevAnswer: "partially_right",
      difficulty: 2,
      flags: { vague: true, note: "no concrete shard key" },
    }
  ),
  turn(
    1,
    "technical",
    "candidate",
    "Shard on account_id. Cross-shard transfers break because you can't hold one database transaction across both sides, so you'd need two-phase commit or an outbox. We used an outbox — write the intent locally, publish it, and let the other shard apply it idempotently on a dedupe key."
  ),
  turn(
    1,
    "technical",
    "interviewer",
    "Good — the dedupe key is the right instinct. That's most of what I wanted from the technical side.",
    { verdictForPrevAnswer: "right", difficulty: 3 }
  ),

  turn(
    2,
    "hiring_manager",
    "interviewer",
    "Riya took you through the technical side, so I'll go somewhere else. You said you led the ledger migration and moved 40% of volume. What part of that was yours specifically?",
    { difficulty: 3 }
  ),
  turn(
    2,
    "hiring_manager",
    "candidate",
    "We got the whole thing across in about seven months. The team staged the cutover carefully and we didn't have a single incident over the severity threshold."
  ),
  turn(
    2,
    "hiring_manager",
    "interviewer",
    "You said “we” three times there. I want your part. What did you decide that someone else on that team would have decided differently?",
    {
      verdictForPrevAnswer: "partially_right",
      difficulty: 3,
      flags: { vague: true, note: "credit hidden behind 'we'" },
    }
  ),
  turn(
    2,
    "hiring_manager",
    "candidate",
    "The order of the cutover was mine. Everyone wanted to move the largest merchant first to prove the thing worked at volume. I pushed to go smallest-first for six weeks so that failures stayed cheap. We caught a rounding bug on a currency we barely processed — if that had landed on the big merchant it would have been a real incident.",
    {}
  ),
  turn(
    2,
    "hiring_manager",
    "interviewer",
    "That's the answer I was after. Let's talk about where that judgement came from.",
    { verdictForPrevAnswer: "right", difficulty: 4 }
  ),
];

export const DEMO_REPORT: FinalReport = {
  sessionId: "demo",
  candidateName: "Jordan Lee",
  overall:
    "Strong on the systems Jordan has actually built, and noticeably stronger under pressure than at first pass. The pattern across both rounds is the same: the first answer is broad, the second one — after being pushed — is specific and good. Jordan reaches for the right primitives (deferred constraints, an outbox with a dedupe key) and can defend them. The gap is self-advocacy: ownership stayed hidden behind “we” until asked twice, and one scaling answer never got past naming a technique. Worth pushing on quantified outcomes before the next round.",
  strengths: [
    {
      statement: "Reaches for the correct concurrency primitive without being led to it.",
      quote:
        "I'd enforce that with a deferred constraint so both sides land in the same transaction",
      round: 1,
      persona: "technical",
      turnId: "demo-2",
      verified: true,
    },
    {
      statement: "Recovers well under pushback — the second answer is concrete and correct.",
      quote:
        "Cross-shard transfers break because you can't hold one database transaction across both sides",
      round: 1,
      persona: "technical",
      turnId: "demo-6",
      verified: true,
    },
    {
      statement: "Made a real call against the room's preference and can explain the payoff.",
      quote:
        "I pushed to go smallest-first for six weeks so that failures stayed cheap",
      round: 2,
      persona: "hiring_manager",
      turnId: "demo-11",
      verified: true,
    },
  ],
  weaknesses: [
    {
      statement: "First answer to a scaling question names a technique but no mechanism.",
      quote: "Sharding, probably, or moving to something with better write throughput",
      round: 1,
      persona: "technical",
      turnId: "demo-4",
      verified: true,
    },
    {
      statement: "Describes owned work in the first person plural until asked twice.",
      quote: "We got the whole thing across in about seven months",
      round: 2,
      persona: "hiring_manager",
      turnId: "demo-9",
      verified: true,
    },
  ],
  perRound: [
    {
      round: 1,
      persona: "technical",
      summary:
        "Opened at level 1 and finished at level 3. Two clean answers on ledger modelling and cross-shard writes, one vague answer on scaling that needed a follow-up before it landed.",
      verdictTally: { right: 2, partially_right: 1, wrong: 0, not_scored: 1 },
    },
    {
      round: 2,
      persona: "hiring_manager",
      summary:
        "Held at level 3 and closed at 4. Needed one direct prompt to separate personal ownership from the team's, then gave a specific decision with a specific consequence.",
      verdictTally: { right: 1, partially_right: 1, wrong: 0, not_scored: 1 },
    },
  ],
  droppedUnverifiedClaims: [
    {
      statement: "Has deep experience running Kubernetes at scale.",
      quote: "we ran everything on Kubernetes across three regions",
      round: 1,
      persona: "technical",
      turnId: "unmatched",
      verified: false,
    },
    {
      statement: "Reduced payment latency by 60%.",
      quote: "latency came down by about sixty percent after the migration",
      round: 2,
      persona: "hiring_manager",
      turnId: "unmatched",
      verified: false,
    },
  ],
  generatedAtMs: Date.now(),
};

/** The rhythm the instrument cycles through in demo mode. */
const SCRIPT: [VoiceState, number][] = [
  ["speaking", 4200],
  ["thinking", 1100],
  ["listening", 5200],
  ["thinking", 1600],
];

/**
 * Read `?demo=` and seed the store. Returns a teardown for the state cycler.
 */
const API = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "";

/** Load a session that really exists on the server into the real screens. */
async function loadSession(id: string, screen: string | null) {
  const get = async <T,>(path: string): Promise<T | null> => {
    try {
      const r = await fetch(`${API}/api/session/${id}${path}`);
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  };

  const transcript = await get<{
    round: number;
    persona: PersonaId;
    difficulty: number;
    turns: Turn[];
  }>("/transcript");

  if (!transcript) {
    useStore.setState({ error: `No session ${id} on the server.` });
    return;
  }

  const report = await get<FinalReport>("/report");
  // The plan drives the round counter and whether "Next round" is offered, so
  // pull the real one rather than rendering a half-populated header.
  const stored = await get<{ channel: string; context: { plan: PersonaId[] } }>("");
  const plan = stored?.context.plan ?? [transcript.persona];

  useStore.setState({
    demo: true,
    plan,
    session: {
      sessionId: id,
      channel: stored?.channel ?? id,
      rtc: { appId: "", token: "", uid: 0 },
      plan,
      disclosureText: "",
    },
    turns: transcript.turns,
    round: transcript.round,
    persona: transcript.persona,
    difficulty: transcript.difficulty,
    startedAtMs: transcript.turns[0]?.tsMs,
    ...(report && screen !== "live"
      ? { phase: "report" as const, report }
      : { phase: "live" as const, voiceState: "listening" as const }),
  });
}

export function startDemo(): (() => void) | undefined {
  const params = new URLSearchParams(window.location.search);
  const which = params.get("demo");
  if (!which) return;

  if (which === "session") {
    const id = params.get("id");
    if (id) void loadSession(id, params.get("screen"));
    return;
  }

  const plan: PersonaId[] = ["technical", "hiring_manager", "behavioural"];

  const session = {
    sessionId: "demo",
    channel: "demo",
    rtc: { appId: "demo", token: "", uid: 0 },
    plan,
    disclosureText: AI_DISCLOSURE_TEXT,
  };

  if (which === "consent") {
    useStore.setState({ demo: true, phase: "disclosure", plan, session });
    return;
  }

  if (which === "report") {
    // The spine is drawn from the real transcript, so the report needs it too.
    useStore.setState({
      demo: true,
      phase: "report",
      report: DEMO_REPORT,
      turns: DEMO_TURNS,
      plan,
    });
    return;
  }

  useStore.setState({
    demo: true,
    phase: "live",
    plan,
    round: 2,
    persona: "hiring_manager",
    difficulty: 4,
    turns: DEMO_TURNS,
    startedAtMs: t0,
    voiceState: "speaking",
    session,
  });

  // A fixed state can be pinned for screenshots: /?demo=live&state=thinking
  const pinned = params.get("state") as VoiceState | null;
  if (pinned) {
    // Keep `muted` consistent with the pinned state, or the controls and the
    // status line contradict the instrument.
    useStore.setState({ voiceState: pinned, muted: pinned === "muted" });
    return;
  }

  let i = 0;
  let timer: ReturnType<typeof setTimeout>;
  const step = () => {
    useStore.setState({ voiceState: SCRIPT[i][0] });
    timer = setTimeout(() => {
      i = (i + 1) % SCRIPT.length;
      step();
    }, SCRIPT[i][1]);
  };
  step();
  return () => clearTimeout(timer);
}
