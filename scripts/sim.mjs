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
const s = await post("/api/session", {
  candidate: {
    name: "Jordan Lee",
    background:
      "Senior backend engineer, 6 years. Go and Postgres. Led a payments platform migration from a monolith to services. Lists 3 years of Kubernetes on the résumé.",
  },
  plan: ["technical", "behavioural"],
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

await runRound("ROUND 1 — technical", "Hi, I'm Jordan — ready to go.", 6);

console.log(cyan("advance -> digest r1, start r2"));
const digestBefore = (await (await fetch(`${B}/api/session/${SID}`)).json());
console.log(JSON.stringify(await post(`/api/session/${SID}/round/next`), null, 2));
const afterNext = (await (await fetch(`${B}/api/session/${SID}`)).json());
console.log("\x1b[90mround-1 digest injected into round 2:\x1b[0m");
console.log(JSON.stringify(afterNext.context.digests, null, 2));

history = []; // Agora agent restarts for the new round
await runRound("ROUND 2 — behavioural", "Hi Alex, good to meet you.", 4);

console.log(cyan("grounded report"));
await post(`/api/session/${SID}/end`);
const report = await post(`/api/session/${SID}/report`);
console.log(JSON.stringify(report, null, 2));
