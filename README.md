# Knot.ai

Adaptive multi-persona AI **voice** interview platform — Echo Sphere hackathon (built on Agora).

A candidate does a spoken, interruptible interview that moves through several
interviewer personas (technical, hiring manager, behavioural, …). Difficulty
adapts to answer quality, vague/contradictory answers get pinned down with
follow-ups, every answer gets an explicit spoken right / partially-right / wrong
verdict, and the final report is **grounded strictly in the real transcript**
(a verification pass drops any claim the model can't cite).

Full design: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Stack

| Layer | Choice |
|---|---|
| Web | React + Vite + Zustand (`apps/web`) |
| Voice in browser | `agora-rtc-sdk-ng` |
| Server | Fastify + TypeScript (`apps/server`) |
| Voice loop | Agora **Conversational AI Engine** (cloud agent: ASR + TTS + VAD) |
| Interviewer brain | Claude (Anthropic Messages API) via our own OpenAI-compatible proxy |
| Storage | SQLite (`better-sqlite3`) |
| Shared types + prompts | `packages/shared` |

Monorepo via npm workspaces.

---

## Quick start (mock mode — no Agora account needed yet)

```bash
npm install
cp .env.example apps/server/.env      # fill ANTHROPIC_API_KEY at minimum; leave MOCK_AGORA=true
npm run dev                            # server on :8787, web on :5173
```

In mock mode the Agora agent lifecycle is stubbed, so you can exercise session
creation, the disclosure gate, the report pipeline, and the grounded-summary
verification against hand-fed transcripts. The live voice loop needs the steps below.

## Going live with Agora

1. **Console checklist** — in `console.agora.io` → your project:
   - copy the **App ID**
   - enable a **Primary Certificate** (needed for RTC tokens)
   - find **Conversational AI Engine** / real-time features — is there an Enable
     button, or is it beta/contact-sales? (if gated, raise it with the organizers)
   - generate a **RESTful API Customer ID + Secret** (Developer Toolkit)
   - decide **TTS**: bundled vendor, or bring an ElevenLabs key (best for
     technical-term pronunciation)
2. Fill `apps/server/.env` with those values and set `MOCK_AGORA=false`.
3. Expose the proxy to Agora's cloud:
   ```bash
   npm run tunnel                      # cloudflared quick tunnel to :8787
   ```
   Put the printed `https://…` URL in `PUBLIC_BASE_URL`.
4. `npm run dev`, open http://localhost:5173, start a session.

---

## Milestones

- [x] **M0** — scaffold, token endpoint, browser joins channel, mic publish
- [x] **M1** — technical-persona loop end-to-end **against a mock Agora** (proxy → Claude, streamed): adaptive difficulty ladder, sub-area rotation, vague/contradiction flags + forced follow-ups, per-answer spoken verdict, transcript logged as grounding source of truth. *Live Agora run still pending (needs tunnel + `MOCK_AGORA=false`).*
- [x] **M2** — persona switching: `startRound`/`endRound`, per-round grounded digest, in-character handoff, "other interviewers' context — don't re-run their topics"
- [x] **M3** — grounded final report: full-transcript summary with mandatory per-claim quotes, then a verification pass that drops any claim not matched to a real candidate turn (`droppedUnverifiedClaims`)
- [ ] **M4** — live Agora integration: confirm `convoAgent.ts` field names, tune VAD, verify MiniMax `tts` block, check technical-term pronunciation, exercise interruption

All of M1–M3 verified via `scripts/sim.mjs` (an LLM-driven candidate hitting the real proxy). What's **not** yet tested: the actual Agora voice loop.

---

## Layout

```
packages/shared/     types, persona defs, all prompt builders (framework-free)
apps/server/
  src/routes/        session lifecycle + OpenAI-compatible /v1/chat/completions proxy
  src/agora/         RTC token builder + Conversational AI Engine REST client
  src/interview/     difficulty ladder, per-round digest, grounded summary, TTS normalise, engine
  src/llm/           Anthropic client + OpenAI<->Anthropic adapters + SSE encoders
apps/web/
  src/agora/         join channel, publish mic, parse caption stream
  src/components/     transcript panel, report view
  src/App.tsx        setup → disclosure → live → report
index.html           the validated no-code prototype (kept for reference / GH Pages)
```

## Scripts

| Command | What |
|---|---|
| `npm run dev` | server + web in parallel |
| `npm run typecheck` | typecheck all workspaces |
| `npm run build` | build all workspaces |
| `npm run tunnel` | cloudflared tunnel to :8787 (needs `cloudflared` installed) |

## Local eval harness

`scripts/sim.mjs` runs a full interview against the live proxy with an **LLM-driven candidate** (no Agora, no mic). Use it to sanity-check prompt / difficulty / grounding changes:

```bash
npm run dev:server        # in one terminal (needs ANTHROPIC_API_KEY)
node scripts/sim.mjs      # in another
```

Set `KNOT_DEBUG=1` on the server to see per-turn `[turn]` lines (sub-area, difficulty, streak, flags).
