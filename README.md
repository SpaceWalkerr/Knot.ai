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
| Web | React + Vite + Zustand + Tailwind v4 (`apps/web`) |
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
- [~] **M4** — live Agora integration. **Tested against the real project; blocked on TTS credentials.**
  - [x] browser RTC join (~330ms with a `buildRtcToken()` token)
  - [x] Convo AI agent join — `convoAgent.ts`'s v2 body accepted first try, returns a real `agent_id`
  - [x] agent actually joins the channel as `AGORA_AGENT_UID` (confirmed from a browser listener)
  - [x] agent teardown / leave
  - [ ] **TTS — the blocker.** The agent joins, reports `RUNNING`, accepts `/speak` with 200, and never publishes audio. MiniMax is not provisioned on the project: set `MINIMAX_GROUP_ID` + `MINIMAX_API_KEY`, or switch `TTS_VENDOR`. Agora validates only the tts *vendor name* at join, so every credential failure is silent — the server now warns at boot instead.
  - [ ] caption wire format, VAD tuning, barge-in, per-round agent handoff (all need working TTS)

All of M1–M3 verified via `scripts/sim.mjs` (an LLM-driven candidate hitting the real proxy), including a full three-persona chain.

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
  src/theme.css      design tokens (see "Design" below) + base + print styles
  src/design/        persona hues and candidate-facing persona copy
  src/screens/       Landing (setup + consent), Live (the interview)
  src/components/    voice instrument, transcript, report, session spine, primitives
  src/demo.ts        dev-only demo harness (see below)
  src/App.tsx        setup → disclosure → live → report
  public/fonts/      self-hosted woff2 (regenerate: node scripts/fetch-fonts.mjs)
index.html           the validated no-code prototype (kept for reference / GH Pages)
```

## Scripts

| Command | What |
|---|---|
| `npm run dev` | server + web in parallel |
| `npm run typecheck` | typecheck all workspaces |
| `npm run build` | build all workspaces |
| `npm run tunnel` | cloudflared tunnel to :8787 (needs `cloudflared` installed) |
| `node scripts/fetch-fonts.mjs` | re-download the self-hosted webfonts into `apps/web/public/fonts` |

## Design

Two rules run through the whole UI, and both are enforced in `apps/web/src/theme.css`:

1. **Mono measures, serif speaks.** Anything the machine counted — round, difficulty,
   timer, verdict, citation — is IBM Plex Mono. Anything a person said or wrote is
   Source Serif 4. Both are self-hosted; nothing is fetched from a CDN at runtime.
2. **Colour is role, not decoration.** Amber is the interviewer's voice, teal is
   yours, violet is the model working. The live screen's state is readable from
   colour alone.

One object carries all three screens: a **dual-channel waveform** with the
interviewer above a shared baseline and the candidate below it. It plays one
exchange on the landing screen, is the hero of the live screen, and compresses
into the session spine on the report. Silence is the baseline itself.

The live session is a dark instrument; the report is a light document
(`data-surface="paper"` re-declares the surface and accent tokens — the accents
are re-cut for the light ground, since the screen values drop to ~1.9:1 on cream).

The waveform is driven by real audio where it exists — `getVolumeLevel()` on the
local mic and the remote agent track — and falls back to a synthesised envelope
*gated by the actual state*, so it never misrepresents who is talking.

## Demo mode (dev only)

The live screen is the hardest one to look at, because it needs Agora minutes and
a live mic. `apps/web/src/demo.ts` seeds a realistic session so it can be opened,
designed against, and demoed for free:

```
http://localhost:5173/?demo=live       # mid-interview, cycling through voice states
http://localhost:5173/?demo=live&state=thinking   # pin one state (speaking|listening|thinking|muted)
http://localhost:5173/?demo=consent    # the disclosure gate
http://localhost:5173/?demo=report     # the finished assessment

# real data — renders the actual screens against a session on the server,
# which is also how you reopen a past report:
http://localhost:5173/?demo=session&id=<sessionId>
http://localhost:5173/?demo=session&id=<sessionId>&screen=live
```

Gated on `import.meta.env.DEV`, or a build made with `VITE_DEMO=1`. In a normal
production build the branch is statically dead and the harness — including its
fake transcript — is dropped from the bundle entirely.

## Local eval harness

`scripts/sim.mjs` runs a full interview against the live proxy with an **LLM-driven candidate** (no Agora, no mic). Use it to sanity-check prompt / difficulty / grounding changes:

```bash
npm run dev:server        # in one terminal (needs ANTHROPIC_API_KEY)
node scripts/sim.mjs      # in another

# any persona chain you like:
KNOT_PLAN=technical,hiring_manager,behavioural KNOT_TURNS=6,4,4 node scripts/sim.mjs
```

Set `KNOT_DEBUG=1` on the server to see per-turn `[turn]` lines (sub-area, difficulty, streak, flags).
