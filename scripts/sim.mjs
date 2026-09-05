// Faithful simulation: LLM-driven candidate that actually answers the
// interviewer's questions. Accumulates history like Agora's max_history.
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const env = Object.fromEntries(
  readFileSync(new URL("../apps/server/.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const B = "http://localhost:8787";
const SEC = env.PROXY_SHARED_SECRET;
const j = async (r) => { if (!r.ok) throw new Error(r.status + " " + (await r.text())); return r.json(); };
const post = (p, body) => fetch(B + p, body
  ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  : { method: "POST" }).then(j);
const cyan = (s) => `\n\x1b[1;36m== ${s} ==\x1b[0m`;

// ---- the simulated candidate --------------------------------------------------
const CANDIDATE_PERSONA = `You are Jordan Lee, a real person being interviewed by voice. You're a senior backend engineer (6y, Go + Postgres) who led a payments platform monolith->services migration.
Answer the interviewer's MOST RECENT question directly and naturally, first person, 2-4 sentences, conversational (this is spoken aloud).
You are competent on databases and system design. You are a bit hazy on Kubernetes (the platform team owned it). Roughly one answer in four, be a little vague/high-level before giving specifics.
Never break character, never mention being an AI. Just answer as Jordan.`;

async function candidateReply(interviewerHistory) {
  const msgs = interviewerHistory.map((m) => ({
    role: m.role === "assistant" ? "user" : "assistant", // flip: interviewer's lines are what Jordan hears
    content: m.content,
  }));
  // ensure it starts with a user turn
  if (msgs.length === 0 || msgs[0].role !== "user") msgs.unshift({ role: "user", content: "(the interview is starting)" });
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 400,
      system: CANDIDATE_PERSONA,
      messages: msgs,
    });
    const txt = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (txt) return txt;
  }
  return "Sorry, could you repeat the question?";
}

// ---- run --------------------------------------------------------------------
// Plan is configurable so the harness can exercise any persona chain:
//   KNOT_PLAN=technical,hiring_manager,behavioural node scripts/sim.mjs
// Turns per round default to 6 for the opener and 4 thereafter (keeps API spend
// sane); override with KNOT_TURNS=6,4,4 or a single number for every round.
const PLAN = (process.env.KNOT_PLAN ?? "technical,behavioural")
  .split(",").map((x) => x.trim()).filter(Boolean);
const TURNS = (() => {
  const raw = process.env.KNOT_TURNS;
  if (!raw) return PLAN.map((_, i) => (i === 0 ? 6 : 4));
  const parts = raw.split(",").map((n) => Number(n.trim()));
  return PLAN.map((_, i) => parts[i] ?? parts[parts.length - 1]);
})();

const PERSONAS = await (await fetch(B + "/api/personas")).json();
const nameOf = (id) => PERSONAS[id]?.displayName?.split(" ")[0] ?? id;

console.log(cyan(`plan: ${PLAN.map(nameOf).join(" -> ")}  (turns ${TURNS.join(",")})`));

const s = await post("/api/session", {
  candidate: {
    name: "Jordan Lee",
    background:
      "Senior backend engineer, 6 years. Go and Postgres. Led a payments platform migration from a monolith to services. Lists 3 years of Kubernetes on the résumé.",
  },
  plan: PLAN,
});
const SID = s.sessionId;
await post(`/api/session/${SID}/disclose`);
await post(`/api/session/${SID}/start`);

let history = []; // what Agora resends each turn

async function turn(candidateText) {
  history.push({ role: "user", content: candidateText });
  const body = await j(await fetch(`${B}/v1/chat/completions?session=${SID}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SEC}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "knot-interviewer", stream: false, messages: history }),
  }));
  const reply = body.choices?.[0]?.message?.content ?? JSON.stringify(body);
  history.push({ role: "assistant", content: reply });
  console.log(`\n\x1b[33mJordan:\x1b[0m ${candidateText}`);
  console.log(`\x1b[32mInterviewer:\x1b[0m ${reply}`);
}

async function runRound(label, opener, nTurns) {
  console.log(cyan(label));
  await turn(opener);
  for (let i = 0; i < nTurns; i++) {
    const c = await candidateReply(history);
    await turn(c);
  }
  const t = await (await fetch(`${B}/api/session/${SID}/transcript`)).json();
  const iv = t.turns.filter((x) => x.role === "interviewer");
  console.log(
    `\x1b[90m  difficulty path: ${iv.map((x) => x.difficulty ?? "-").join(" -> ")} | verdicts: ${iv.map((x) => x.verdictForPrevAnswer).join(",")}\x1b[0m`
  );
}

for (let i = 0; i < PLAN.length; i++) {
  const persona = PLAN[i];
  const opener =
    i === 0 ? "Hi, I'm Jordan — ready to go." : `Hi ${nameOf(persona)}, good to meet you.`;
  await runRound(`ROUND ${i + 1} — ${persona}`, opener, TURNS[i]);

  if (i === PLAN.length - 1) break;

  console.log(cyan(`advance -> digest r${i + 1}, start r${i + 2}`));
  console.log(JSON.stringify(await post(`/api/session/${SID}/round/next`), null, 2));
  const after = await (await fetch(`${B}/api/session/${SID}`)).json();
  console.log(`\x1b[90mdigests carried into round ${i + 2}:\x1b[0m`);
  console.log(JSON.stringify(after.context.digests, null, 2));

  history = []; // Agora restarts the agent for each new persona
}

console.log(cyan("grounded report"));
await post(`/api/session/${SID}/end`);
const report = await post(`/api/session/${SID}/report`);
console.log(JSON.stringify(report, null, 2));
