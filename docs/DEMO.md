# Knot.ai — demo script & judge Q&A

Live app: **https://knot-ai.onrender.com** · Repo: `SpaceWalkerr/Knot.ai`

---

## Before you go on

- [ ] Do a warm-up run 5 min before (Render free tier sleeps; a cold start mid-demo breaks the voice loop). The `keep-warm` GitHub Action helps, but don't rely on it alone — or upgrade Render to Starter.
- [ ] Chrome, mic permission already granted for the site.
- [ ] Have your candidate answers loosely planned (below) so the report looks sharp.
- [ ] Backup: a screen recording of a full run, in case the venue wifi is bad.

---

## The 3-minute demo

### 0:00 — Frame it (20s)
> "Knot.ai is an adaptive, multi-persona **voice** interview. You talk to a panel of interviewers — technical, hiring manager, behavioural — it gets harder when you're doing well, pins you down when you're vague, and at the end gives you a report where **every claim is a quote from what you actually said.**"

Click **Start** → show the setup form is already filled → **Continue**.

### 0:20 — AI disclosure (10s)
> "Clear AI disclosure up front — it tells the candidate it's an AI before the mic opens."

Click **I understand — start**. Mic goes live.

### 0:30 — Live interview (90s)
The interviewer (Riya, technical) greets you and asks a warm-up.

- **Answer the first question well** (a crisp, specific answer). → Point out: *"It said 'that's right' and moved up in difficulty."*
- **Give one deliberately vague answer** ("it depends, you use best practices"). → Point out: *"It caught that — it's not moving on, it's asking me to be concrete."*
- **Answer that follow-up with specifics.** → difficulty steps back up.
- **Interrupt it mid-question.** → *"Natural turn-taking — I can cut in like a real conversation."*
- Watch the **transcript panel** fill in, the **difficulty meter** move, **verdict chips** appear.

### 2:00 — Persona handoff (20s)
Click **Next round**.
> "It hands off to the next interviewer — the behavioural one — and carries a factual summary of what I've shown so far, so it doesn't re-ask the same ground."

The new interviewer intros itself and asks a behavioural question. Answer briefly.

### 2:20 — The report (35s)
Click **End & get report**.
> "Here's the grounded assessment. Every strength and weakness has a **verbatim quote** and which round it's from. Anything the model tried to claim that it *couldn't* tie to the transcript got **dropped before I saw it** — that count is shown. This is the anti-hallucination guarantee."

Scroll the strengths / weaknesses / per-round tally. Land on the dropped-claims line.

### 2:55 — Close (5s)
> "Built on Agora's Conversational AI Engine for the voice loop, Claude for the interviewer and the grounded report. That's Knot.ai."

---

## Architecture — one paragraph (for judge questions)

> The browser does WebRTC with **Agora's Conversational AI Engine**, which runs the cloud voice agent — speech-to-text, turn detection, text-to-speech. The agent's "brain" is an **OpenAI-compatible proxy we wrote**, so every single conversational turn passes through our backend before it reaches Claude. That's the key design choice: the difficulty ladder, the topic rotation, the vague/contradiction detection, and the transcript logging all live in that proxy as **deterministic control**, not as instructions we hope the model follows. Each interview round is a fresh agent with a composed system prompt = persona + a factual digest of prior rounds, so context carries across personas without re-litigating. The final report passes the **full logged transcript** to Claude with a schema that forces a verbatim quote on every claim, then a **verification pass** fuzzy-matches each quote back against the transcript and drops anything that doesn't match.

## Likely judge questions

**"How do you stop the LLM from hallucinating the report?"**
Two layers. The generation prompt requires a `quote` + `round` + `turnId` on every strength/weakness and allows "insufficient evidence" as an answer. Then a verification pass normalises and fuzzy-matches each quote against the real candidate turns; unmatched claims are dropped and counted. The transcript it grounds against is our proxy's own turn log, not Agora's (lossier) caption stream.

**"Why a proxy instead of just prompting the model?"**
We tested prompt-only control with an LLM-driven candidate. The model ignored "adjust difficulty by one level" and "cover three sub-areas" — it tunnel-visioned and escalated freely. Deterministic state in the proxy (a streak counter for difficulty, a sub-area rotation counter) fixed it. The model gets a per-turn "director note"; the pacing is enforced by code.

**"How is context shared between the personas?"**
After each round, Claude produces a factual digest — 3-6 bullets grounded in that round's transcript, plus a list of covered topics. Only the digest crosses into the next persona's prompt. Keeps prompts small, keeps personas independent, tells the next interviewer what not to re-ask.

**"What was the hardest part?"**
Getting Agora's Conversational AI Engine to actually produce audio over the REST API — the managed model credentials need `credential_mode: "managed"` **and** the vendor's own endpoint URL on each stage, which isn't in the quickstart docs. Without both, the agent joins, reports RUNNING, and stays silent with no error anywhere.

**"What's the difficulty logic exactly?"**
1–5 scale, starts at 1. Two consecutive un-flagged answers → +1. A contradiction → −1. A vague or too-short answer → hold and force a narrow follow-up. Never more than one step per turn, never escalates on a weak answer.

**"Could this scale to real hiring?"**
The grounding mechanism and the structured per-round verdicts are the foundation for that. Today it's practice-only with an explicit disclosure — deliberately not a hiring decision.

## Stack

React + Vite (web) · Fastify + TypeScript (server, single Dockerized service on Render) · Agora Conversational AI Engine (voice) · Agora-managed Deepgram ASR + MiniMax TTS · Claude Sonnet (interviewer + digests + grounded report) · SQLite.
