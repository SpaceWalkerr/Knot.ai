# Knot.ai — Architecture

Adaptive multi-persona AI voice interview platform. Built on Agora's Conversational
AI Engine for the real-time voice loop; Claude for the interviewer brain, per-round
digests, and the transcript-grounded final report.

---

## 1. High-level shape

```
┌────────────┐        RTC (mic + agent audio, captions)        ┌──────────────────────┐
│  Browser   │◄──────────────────────────────────────────────►│  Agora Convo AI      │
│  (React,   │                                                 │  cloud agent         │
│  Vite)     │        REST: create / start / next / end / report│  (ASR + TTS + VAD)  │
│            │────────────┐                                     └─────────┬────────────┘
└────────────┘            │                                               │
                          ▼                              per-turn POST /v1/chat/completions
                 ┌───────────────────────┐                                │
                 │  Fastify server       │◄───────────────────────────────┘
                 │  (@knot/server)       │
                 │                       │──► Claude Messages API (live model)
                 │  • session lifecycle  │──► Claude Messages API (summary model)
                 │  • OpenAI-compat proxy │
                 │  • difficulty ladder  │
                 │  • transcript store   │  (SQLite — grounding source of truth)
                 │  • grounded summary   │
                 └───────────────────────┘
```

The browser never talks to Claude or to the Agora REST API directly. The
**Fastify server owns all interview logic and all state.**

---

## 2. The proxy is the product

Agora's Conversational AI Engine requires a **BYO LLM endpoint that speaks the
OpenAI `POST /v1/chat/completions` protocol**. Instead of pointing it at Anthropic
(which isn't OpenAI-shaped) or OpenAI directly, we point it at
**`/v1/chat/completions` on our own server** (`apps/server/src/routes/chatCompletions.ts`).

Every conversational turn therefore passes through our code, where we:

| Responsibility | Where |
|---|---|
| Inject the composed persona system prompt | `engine.runProxyTurn` → `buildRoundSystemPrompt` |
| Score the candidate's last answer (fast, deterministic) | `interview/difficulty.ts` → `assessAnswer` |
| Move the difficulty ladder (≤ ±1, never escalate on a weak answer) | `difficulty.ts` → `nextDifficulty` |
| Force a targeted follow-up on vague / contradictory answers | `difficulty.ts` → `shouldForceFollowUp` + `buildTurnDirective` |
| Require an explicit spoken verdict each turn | prompt (`buildRoundSystemPrompt` rule 4) + `parseVerdict` |
| **Log every turn verbatim** to SQLite | `db.appendTurn` — this is the grounding source of truth |
| Normalise technical terms for TTS | `interview/ttsNormalize.ts` |
| Stream the reply back as OpenAI SSE | `chatCompletions.ts` |

Because Agora doesn't pass the channel name to the LLM, the server identifies the
session two ways (belt + braces): a `?session=<id>` query param on `llm.url`, and a
`[session:<id>]` marker appended to the system prompt.

**Fallback if the proxy is unreliable in the venue:** point Agora's `llm.url` at
OpenAI directly for the live loop and keep Claude only for `makeRoundDigest` +
`generateGroundedReport`. You lose live difficulty steering and per-turn logging
(fall back to Agora's caption stream for grounding, with quality loss).

---

## 3. Personas: separate prompts, one shared context store

**Decision: one agent lifecycle per round.** Not a single mega-agent switching
personas mid-stream (fragile, context bleeds), not N concurrent agents (wasteful,
no shared-channel benefit).

Each round the server calls Agora `leave`, then `join` again **on the same RTC
channel** with a freshly composed system prompt:

```
system prompt (round N) =
    personaTemplate(persona)          // focus + demeanour, from packages/shared/personas.ts
  + candidate profile                 // provided at session creation
  + renderPriorDigests(digests[0..N-1])   // factual, grounded, "don't re-ask X"
  + difficulty + turn-taking rules
```

The 1–3 s reconnect gap is turned into a **diegetic handoff**:
"Thanks — I'll bring in Marcus (Hiring Manager) now."

### Candidate context between stages

`SessionContext` (owned by our SQLite `sessions` row) carries:

- `candidate` — name, background, target role
- `plan` — ordered `PersonaId[]` (default: technical → hiring_manager → behavioural)
- `digests` — one `RoundDigest` per completed round
- `currentRound / currentPersona / currentDifficulty`

**Only the digest crosses a round boundary**, not the raw transcript. After each
round `makeRoundDigest` (`interview/context.ts`) asks Claude for STRICT JSON:

```jsonc
{
  "bullets": ["3–6 factual statements grounded in THIS round's transcript"],
  "coveredTopics": ["labels the next interviewer must not re-ask"],
  "endDifficulty": 1
}
```

This keeps each prompt small, keeps personas independent, and gives the next
interviewer "what the candidate has actually demonstrated so far" + "what's already
been covered" + "probe any contradiction with the above."

---

## 4. Dynamic difficulty

Ladder is `1..5` (`DifficultyLevel`). Rules, enforced in `difficulty.ts` (not just
prompt text):

- Round starts at **1** (warm-up: definitions, "walk me through").
- After each answer, `assessAnswer` produces `{ quality 0..1, vague, contradictory }`
  from cheap signals: length, vague-phrase hits ("it depends", "best practices"),
  concrete signals (numbers with units, "because", "trade-off", "we measured"),
  naive contradiction match against prior candidate claims.
- `nextDifficulty`: `quality ≥ 0.7` → +1; `quality ≤ 0.35` → −1; vague/contradictory
  → **hold** and force a follow-up. Never more than ±1. A weak answer **never**
  escalates.
- The target level is passed to Claude as a `[DIRECTOR NOTE — not spoken]` system
  directive for that turn only (`buildTurnDirective`), so the base prompt stays
  stable/cacheable.

---

## 5. Vague / contradictory detection → targeted follow-up

Two layers:

1. **Deterministic pre-screen** (`assessAnswer`): flags short answers, ≥2 vague
   phrases, or a vague phrase with zero concrete signals; naive contradiction
   check against earlier candidate claims (`collectCandidateClaims`).
2. **Prompt instruction**: rule 5 of `buildRoundSystemPrompt` tells the interviewer
   to *not move on* and instead ask "one narrow, concrete follow-up" when the last
   answer was vague or contradicted anything from any round.

When layer 1 fires, `buildTurnDirective` injects
`"The candidate's last answer was <reason>. Do NOT advance. Ask one narrow
follow-up that forces a specific, checkable detail."` and the ladder holds.

The flags are also persisted on the `Turn` and shown in the UI transcript
("flagged vague" / "flagged contradiction").

---

## 6. Per-answer spoken feedback

Rule 4 of the persona prompt fixes the shape of every interviewer turn:

1. Opens with exactly one of **"That's right" / "That's partially right" /
   "That's not right"**.
2. One or two sentences on **why**, referencing something the candidate said.
3. Then either the follow-up (if flagged) or the next question.

`parseVerdict` reads that prefix back off the reply and stores it as
`Turn.verdictForPrevAnswer` (`right | partially_right | wrong | not_scored`),
which drives the per-round verdict tally in the report and the verdict chips in
the live transcript.

---

## 7. Transcript-grounded final report

`interview/grounding.ts` → `generateGroundedReport`. **Two stages, by design —
not a prompt suggestion:**

### Stage 1 — generate

Pass the **complete** structured transcript (every `Turn`: `turnId, round, persona,
role, text` — from our proxy log, *not* Agora's lossy caption stream) to Claude
with `buildGroundedSummaryPrompt`, which demands STRICT JSON where **every strength
and weakness must carry `{ quote, round, persona, turnId }`** and `"insufficient
evidence"` is an allowed value. The prompt forbids introducing any topic/tech/
project not present in the transcript.

### Stage 2 — verify (the actual guardrail)

For every claim, `isQuoteGrounded` checks the `quote` against the real transcript:

1. normalise (lowercase, strip punctuation, collapse whitespace)
2. exact containment in the cited candidate turn, **or**
3. containment in *any* candidate turn (turnId may be slightly off), **or**
4. ≥ 0.8 token-overlap with the cited turn

Claims that fail are **dropped before the report renders** and kept in
`droppedUnverifiedClaims` (surfaced in the UI as "grounding guardrail working").

Result: the report can only say things the candidate actually said.

---

## 8. AI disclosure

- `AI_DISCLOSURE_TEXT` (in `packages/shared/prompts.ts`) is shown on the
  **Disclosure** screen; the candidate must click "I understand — begin" before
  the RTC channel is joined (`POST /api/session/:id/disclose`).
- Round 1's system prompt also instructs the interviewer to restate "I'm an AI
  interviewer" in its first spoken line, and the agent `greeting_message` repeats it.

---

## 9. Turn detection / interruption (configured, never default)

`apps/server/src/agora/convoAgent.ts` → `VAD` block + `advanced_features`:

| Param | Value | Meaning |
|---|---|---|
| `threshold` | `0.5` | speech-probability gate (lower = more sensitive) |
| `prefix_padding_ms` | `300` | audio kept before detected speech start |
| `silence_duration_ms` | `640` | trailing silence that ends the candidate's turn |
| `interrupt_duration_ms` | `160` | candidate speech this long barges in over the agent |
| `advanced_features.enable_aivad` | `true` | Agora's AI VAD — better turn-taking than plain energy VAD |
| `advanced_features.enable_bhvs` | `true` | background-noise / non-human-voice suppression |

Tune these in the first live test. Field names must be confirmed against current
Agora docs (see the ⚠️ note in `convoAgent.ts`).

---

## 10. Data model (SQLite via better-sqlite3)

| Table | Contents |
|---|---|
| `sessions` | one JSON blob per `Session` (status, channel, `SessionContext`, `agentId`) |
| `turns` | append-only; one row per utterance (`Turn`), ordered by `seq` — **grounding source of truth** |
| `reports` | one `FinalReport` JSON per session |

---

## 11. Build order (see README "Milestones")

- **M0** scaffold + token endpoint + browser joins channel + mic echo
- **M1** single persona (technical) end-to-end: proxy → Claude → Agora, spoken
  verdicts, live transcript
- **M2** persona switching: `startRound` / `endRound`, digests, handoff UI
- **M3** grounded report + verification pass + report screen
- **M4** polish: difficulty tuning, contradiction pass, TTS pronunciation, disclosure copy

---

## 12. Known Agora constraints (design already accounts for these)

1. **`llm.url` must be public** — Agora's cloud calls it. Dev: `npm run tunnel`
   (cloudflared). Demo: deploy the server. `MOCK_AGORA=true` runs everything
   except the real agent.
2. **Conversational AI Engine must be explicitly enabled** on the Agora project
   and may be access-gated. Confirm in the console (see README checklist).
3. **Persona switch = leave/rejoin**, ~1–3 s gap → diegetic handoff.
4. **Caption stream is lossy** → proxy log is the grounding source of truth.
5. **TTS vendor key is separate** unless using a bundled option; ElevenLabs /
   Cartesia pronounce technical terms best.
6. **Convo AI has its own per-minute billing** → always `leave` on end; consider a
   sweeper for abandoned sessions.
