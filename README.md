# AI front office for HVAC & plumbing shops

An agent that does the dispatcher / CSR job at a residential HVAC and plumbing company. It covers everything from the first call to the paid invoice. The demo company, **Northline Heating & Plumbing** (Denver), is fictional; the product itself is unnamed.

**Why this role:** the dispatcher/CSR is the busiest seat in a trades shop. Every missed call is a lost job, emergencies get handled first-come-first-served, and invoices go out days late. The agent answers every contact in seconds, books against a real fleet plan, re-plans when the day changes, and chases the money. The owner stays in control through a policy engine and approvals.

---

## What it does

| Area | What happens | Where to see it |
|---|---|---|
| **Intake** | Browser voice receptionist (Gemini Live), email (Gmail poll or the test form) and web booking all go through one pipeline: safety check, triage (priority, trade, reasons), booking, reply with a tracking link. | `/book`, Inbox |
| **Photo quotes** | Customer photos of the unit, its label or error lights → Gemini vision diagnosis → good / better / best options, priced only from the price book. Units past their expected lifespan are flagged as replacement leads. | `/book` → Details & photos, Quotes & invoices |
| **Fleet dispatch** | Skills, time windows, priority and real drive times (OpenRouteService matrix) → optimised routes for 5 techs. It re-plans on every emergency, delay, sick call or finished job and tells the customers it moves. | Dispatch board |
| **Technician app** | Telegram, no typing needed. A persistent button keyboard (My route, Running late, Job done, Send location). Today's route arrives as an **interactive HTML widget** (Bot API 10.4) with On my way / Arrived / Job done per visit. Live location drives customer ETAs. | Telegram, `/c/track/…` |
| **Job-to-cash** | Tech sends a voice note → job report → invoice → Stripe **test-mode** payment link → automatic reminders until paid. | Quotes & invoices |
| **Office group** | A pinned **button panel** (Brief, Board, Approvals with a live count, Re-plan, Ask the copilot). Answers are **ephemeral** (Bot API 10.2/10.4): only whoever tapped sees them. Approval cards can be approved or rejected by anyone in the group; the card shows who decided. | Telegram group |
| **Guardrails** | Every action passes a policy engine: *auto*, *needs approval* or *never*, per action type. Low model confidence forces approval. Every model call, tool call and policy decision is traced. | Approvals, Agent traces, Settings |
| **Agent persona** | Name, call voice (Gemini Live prebuilt), tone, how customers are addressed, call opening line and message sign-off. Applied to the voice prompt and to every outbound customer message. | Settings → Agent persona |
| **Agent chat** | The owner talks to the same persona (Agent page, top-bar ask field, Telegram panel). Answers from live data, shows which tools it used and links to the trace. | Agent |
| **Agent team** | Five specialists with recent runs, failures and tokens. Per agent: supervised mode (everything waits in Approvals) and custom instructions appended to its prompts. | Agent team |
| **Proof** | A day simulator (AI office vs a human-office baseline, same demand, same fleet) and a labelled triage eval set with a held-out split. | ROI & simulator |

### Proactive (scheduled) work

| Job | Schedule | What it does |
|---|---|---|
| `tick` (watchdog) | every minute | Polls Gmail, raises SLA alerts for unanswered urgent requests, drains the job queue, checks Stripe for payments |
| `morning` | 06:30 company time | Re-plans the day, sends each tech their route, sends the owner a summary |
| `weather` | 06:00 company time | Checks the Open-Meteo forecast; a cold snap or heat wave drafts a targeted maintenance campaign (sending it needs approval) |

Locally these run on in-process timers. In production, Cloud Scheduler calls `POST /api/cron/<name>` with `Authorization: Bearer $CRON_SECRET`.

### Free APIs used

Gemini (text, vision, Live voice) · Telegram Bot API · OpenRouteService · Open-Meteo · Nominatim (OpenStreetMap geocoding) · Stripe (test mode) · Gmail + Google Calendar (optional, OAuth).

---

## Measured results

Both tables come from running the code in this repo (`ROI & simulator` page, or the functions in `src/server/sim/`).

### Day simulator: 120 contacts, 5 technicians, seed 7

The human baseline is 1 CSR + 1 dispatcher working 08:00–17:00. They answer one call at a time (~6 min each), callers hang up after a few minutes on hold, about 45% of after-hours voicemails are never recovered, and dispatch is first-come-first-served with only explicit emergencies fast-tracked. The AI never sees a request before it arrives and re-plans every 15 minutes.

| | Normal day: AI | Normal day: Human | Cold snap: AI | Cold snap: Human |
|---|---|---|---|---|
| Contacts answered / lost | 120 / 0 | 79 / 41 | 120 / 0 | 79 / 41 |
| Median time to answer | 0.2 min | 10 min | 0.2 min | 10 min |
| Jobs completed today | **37** | 30 | **41** | 28 |
| Emergencies served today | **16 / 16** | 4 / 16 | **31 / 75** | 16 / 75 |
| Avg emergency wait (request → arrival) | 1 h 46 m | 6 h 2 m | 3 h 39 m | 6 h 11 m |
| Revenue completed today | **$15,140** | $12,160 | **$17,835** | $13,200 |
| Drive minutes per job | 26 | 36 | 21 | 38 |
| Technician utilisation | 77% | 63% | 85% | 59% |

The simulator is a model, not a field trial. The baseline's assumptions are listed above and in `src/server/sim/simulator.ts`, so you can disagree with them and re-run.

### Triage evals: 45 labelled customer messages

The set includes a prompt-injection attempt and messages in Spanish. **Dev** (30 cases) was used to tune the rule-based fallback; **held-out** (15 cases) was written afterwards.

| Metric | Rules: dev | Rules: held-out | Gemini + rules: dev | Gemini + rules: held-out |
|---|---|---|---|---|
| Priority exact | 100% | 60% | 87% | **87%** |
| Priority within one level | 100% | 93% | 100% | **93%** |
| Emergency (P1) recall | 100% | 60% | 100% | **100%** |
| Safety hazard recall | 100% | 100% | 100% | **100%** |
| Over-escalated to P1 | 0 | 0 | 3 | **2** |
| Trade / skill routing | 100% | 73% | 97% | **93%** |

The Gemini run was on 2026-11-26 through the model fallback chain (`GEMINI_MODEL`, then the Flash-Lite models when it was overloaded), so some cases may have been answered by a lighter model. On held-out cases, Gemini catches every emergency the rules miss. The cost is over-escalation: 2 of 15 messages were bumped to P1 that a human labelled lower. For a dispatcher that is the safer error, but it costs a truck roll.

**Disclosure:** the 100% dev scores show the rules were fitted to those cases; the held-out column is the honest number. After first seeing the held-out set I widened one safety pattern (to also match "natural gas"). That makes the held-out *safety* recall slightly optimistic. No other change was made after seeing the held-out cases.

---

## Run it locally

**Needs:** Node 22+ (developed on 24), pnpm, and PostgreSQL 14+ (the `btree_gist` extension must be available; the migration creates it).

```bash
pnpm install
cp .env.example .env        # then fill in the keys below
createdb dispatch_agent
pnpm db:migrate
pnpm db:seed                # 5 techs, 40 fictional customers, a partly booked 3-day schedule
pnpm dev                    # http://localhost:3000 → owner sign-in (password `demo`); customers book at /book
```

Every integration is optional. Without a key, the feature falls back (rules instead of Gemini, estimated drive times instead of ORS, an outbox instead of delivery) and Settings shows what's missing.

| Variable | Get it from | Used for |
|---|---|---|
| `GEMINI_API_KEY` | aistudio.google.com → Get API key | triage, photo diagnosis, voice, agent chat |
| `GEMINI_MODEL` | default `gemini-3.8-flash` | falls back through Flash-Lite models when overloaded |
| `TELEGRAM_BOT_TOKEN` | @BotFather → /newbot | technician app, office group |
| `TELEGRAM_OWNER_CHAT_ID` | optional; the group's chat id | the office group (or send `/owner` in the group instead) |
| `ORS_API_KEY` | openrouteservice.org → Dashboard | real drive-time matrices |
| `STRIPE_SECRET_KEY` | Stripe dashboard, **test mode** (`sk_test_…`) | payment links |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client (web); redirect URI `$APP_URL/api/google/callback` | Gmail intake and replies, Calendar sync |
| `APP_URL` | `http://localhost:3000` locally | links sent to customers |
| `OWNER_PASSWORD` | anything; `demo` when empty | owner dashboard sign-in |
| `SESSION_SECRET` | any long random string | signs the owner session cookie |
| `CRON_SECRET` | any long random string | protects `/api/cron/*` |
| `COMPANY_TZ` | default `America/Denver` | business hours, morning jobs |

### Telegram setup (2 minutes)

1. Create the bot with @BotFather and put the token in `.env`.
2. **Office group:** add the bot to a group with everyone who should see alerts, then send `/owner` there (or set `TELEGRAM_OWNER_CHAT_ID`). The bot posts the button panel and pins it if it is an admin; `/menu` re-posts it.
3. **Technicians:** each tech opens a private chat with the bot, sends `/start` and taps their name. The button keyboard appears under the chat.

Telegram currently delivers HTML widgets only in **private chats** in production. Techs get the widget; on a client that can't show it, the route falls back to text with inline buttons. Ephemeral messages work in groups.

### Checks

```bash
pnpm typecheck
pnpm test        # optimiser unit tests
pnpm build       # production build → .output/
```

---

## Deploy (Google Cloud Run + Cloud Scheduler)

```bash
pnpm build
# Postgres: Neon free tier or Cloud SQL; run `pnpm db:migrate` and `pnpm db:seed` against it once.
gcloud run deploy dispatch-agent --source . --region us-central1 \
  --set-env-vars "APP_URL=https://<service-url>,EXTERNAL_CRON=1,DATABASE_URL=…,GEMINI_API_KEY=…,…" \
  --min-instances 1 --no-cpu-throttling
```

- Cloud Run's Node buildpack runs `pnpm build` and then `pnpm start` (`node .output/server/index.mjs`).
- `--min-instances 1 --no-cpu-throttling` keeps one instance alive. The Telegram bot uses long polling and the queue worker runs in-process, so both need a running instance.
- `EXTERNAL_CRON=1` turns off the local timers. Create the three jobs:

```bash
for job in "tick:* * * * *" "morning:30 6 * * *" "weather:0 6 * * *"; do
  name=${job%%:*}; cron=${job#*:}
  gcloud scheduler jobs create http "dispatch-$name" --location us-central1 \
    --schedule "$cron" --time-zone "America/Denver" --http-method POST \
    --uri "https://<service-url>/api/cron/$name" \
    --headers "Authorization=Bearer $CRON_SECRET"
done
```

- With an `https` `APP_URL`, approval cards in Telegram also get an "Open dashboard" button.

---

## How it's built

```
 customers ──voice/email/web──▶ Front desk agent ──┐
 technicians ──Telegram──────▶ Technician bot ────┤        ┌──▶ SSE ─▶ dashboard (live)
 office group ──Telegram─────▶ Owner bot / copilot ┼─▶ event bus (Postgres log) ──┤
 schedulers ──/api/cron──────▶ Ops jobs ──────────┘        └──▶ agents react (re-plan, notify, chase)
                                    │
                         policy engine: auto / approve / never ─▶ approvals ─▶ executors
                                    │
                         traces: every LLM call, tool call, policy decision (timed, token-counted)
```

- **Stack:** TanStack Start (React 19, Vite, Nitro), PostgreSQL with Drizzle, Tailwind 4 with shadcn/ui, Leaflet, Recharts.
- **No double booking**, enforced by the database: a deferred `EXCLUDE USING gist` constraint per technician over the live visit window. A durable job queue uses `SKIP LOCKED`.
- **Dispatch optimiser** (`src/server/domain/optimizer.ts`): regret-2 insertion (urgent and hard-to-place jobs first), then relocate + swap local search, over skills, time windows, priority, job value and the ORS travel matrix. It is pure and deterministic, so the simulator can run it thousands of times. The unit tests are in `tests/`.
- **Gemini:** structured JSON output with zod validation. A model fallback chain handles 503s, and every call has a 10 s timeout. The Live voice session uses an ephemeral token minted by the server, and its `book_service` tool call goes back through the same policy engine.
- **Prompt injection:** customer text is always passed as data, never as instructions. The eval set includes an injection case.

```
src/
  routes/            pages (customer: /book, /c/*; dashboard: /app/*) and API routes (/api/events, /api/cron, /api/google)
  server/agent/      front desk, diagnosis, revenue, technician + route widget, owner bot, copilot, policy, traces
  server/domain/     triage, dispatch / re-plan, optimiser, messaging, settings
  server/integrations/  gemini, telegram, routing (ORS), weather, stripe, google
  server/jobs/       scheduled jobs and queue handlers
  server/sim/        day simulator, triage evals
  ui/                shared UI (live data provider, map, voice client, theme, motion)
```

## Honest limits

- Demo data is fictional, and payments are Stripe **test mode** only.
- Voice runs in the browser only (no phone number).
- The eval set is small (45 cases). Treat the percentages as directional.
- The simulator compares against a modelled human office, not a measured one.
- Without an ORS key (or when ORS is slow), drive times fall back to distance-based estimates, and traces say so.
- Telegram widgets reach techs only in private chats. That's a Telegram production limit, not a choice.
