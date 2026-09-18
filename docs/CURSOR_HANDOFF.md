# Buffer: handoff prompt for Cursor

Paste everything below this line into a Cursor chat in the BUFFER repo (or keep this file open and @-mention it). It tells the assistant what the project is now, what changed, and how to work on it without breaking the conventions.

---

You are helping Sanjana work on **Buffer**, a Next.js 16 app in this repo (`SANA2106/BUFFER`, branch `main`, deployed on Vercel). It is a WhatsApp-style chat assistant. Read this whole brief before touching code. State as of 18 September 2026.

## What Buffer is now

The purpose changed from "plan this social event" to **life first**: you tell Buffer when you work, it shows you when you are actually free (as pictures, not text blocks), and it helps you spend that free time on people: a call home, an evening with roommates, coffee with a friend. Work goes in so the people time can be planned around it. Everything Buffer saves also lands on Google, Apple, Android and Outlook calendars through a private ICS feed (`connect calendar`).

The user experience, in order:

1. **Name**: any sentence works ("hi im ved" becomes Ved; `src/lib/names.ts`).
2. **Four setup questions**, each with buttons but answerable in plain words: usual work hours (or "it varies"), when they switch off in the evening, who they want to make time for ("my mom, and remind me to spend time with my roommates too"), and whether Buffer may send browser notifications for the evening nudge (the *Allow nudges* button asks the browser).
3. Then plain text: `work 7 to 10pm today`, `shift 9 to 5 tomorrow`, `every weekday 9 to 5 i have class` (standing hours), `no class tomorrow`, `dinner with sam friday 8pm`, `remind me to call nani` (a to-do), `reserve friday evening`, `plan people time`, `my week`, `today`, `undo`, `push 30 min later`, `make it 2h`, `move gym to 8pm`, `done with the deck`, `nudge me to call mum`, `who do i call`, `set up again`.
4. **Pictures**: the week as bars (white free, grey work, no numbers; the pictures are monochrome and purple is the only accent, reserved for draggable or just-changed blocks), a day as a strip plus a list of blocks. A picture is always its own bubble, sent before the words. Saved blocks on the day strip can be dragged to a new time (15-minute snaps); the drop is sent as `move Work to 8 pm today` and Buffer asks before moving it (`ScheduleImage` in `schedule-image.tsx`, the `dragged` fast path in `bot.ts`).
5. **Evening nudge**: once a day, in the 90 minutes after the switch-off time, if nothing is on: "you're off the clock. Mum would love to hear from you." with *Calling Mum now / Remind me tonight / Skip today*. Groups (roommates, friends, family) are phrased as time together. With notifications allowed it also pops up as a browser notification while the tab is open.
6. **Plan people time**: one slot this week per person named, at humane hours (calls a little after switch-off or late morning on weekends, evenings for groups). Tapping one puts it on the calendar. This is offered after setup, after every work block, in the week reply and in the menu.

## The brain

`src/lib/llm.ts` sends each message, plus context (time zone, settings, events, to-dos, people, recent chat, any half-finished draft), to a language model with a JSON schema (zod) and gets back one typed action, or, when the person goes off script, the actual words to say back (`reply`), a short tailored opener for action replies (`lead`), and any people mentioned in passing (`people`). The scheduler (`src/lib/scheduler.ts`, `src/lib/life.ts`) does all the calendar arithmetic deterministically. The setup answers go through a second, smaller schema (`SetupSchema`) so loose answers and several answers at once are understood.

The model is whatever the environment points at, open models first:

| Env var | Model |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio free tier. Buffer lists the models the key can use and picks the newest Flash-Lite (currently `gemini-3.5-flash-lite`), skipping models Google lists but refuses. Set `LLM_MODEL` to pin one. |
| `GROQ_API_KEY` | Llama 3.3 70B on Groq, free tier |
| `OPENROUTER_API_KEY` | `google/gemma-3-27b-it:free` |
| `OLLAMA_MODEL` | a local Ollama (dev only) |
| `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` | any OpenAI-compatible endpoint |
| `ANTHROPIC_API_KEY` | Claude |
| nothing | the regex parser in `src/lib/nlp.ts`. Handles the buttons and standard phrasings, nothing off script. |

**Sanjana's Vercel project (`buffer-ashen.vercel.app`) has no key yet, so it is on the regex parser.** To make it conversational: Vercel > the project > Settings > Environment Variables > add `GEMINI_API_KEY` (free key from aistudio.google.com, "Get API key", no card) > redeploy. Nothing else is needed; the model is picked automatically.

Two deployments exist right now:

- `SANA2106/BUFFER` `main` -> `https://buffer-ashen.vercel.app` (Sanjana's Vercel team). Source of truth.
- `EchoVial/BUFFER` (Ved's fork, kept identical to `main`) -> `https://buffer-psi.vercel.app` (Ved's Vercel team, has the key). This exists only because Vercel's preview deployments on Sanjana's team require team login and Ved is not a member. Once Sanjana's project has a key, the fork can go.

If you push to `SANA2106/BUFFER` `main`, tell Ved so the fork is synced (or he can set it to sync from upstream). Do not create PRs for routine work; `main` deploys directly.

## Code map

- `src/lib/bot.ts`: the conversation. `processTurn(user, text)` is the entry point. Order inside it: setup steps (`handleOnboarding`), fast paths for button payloads and one-word commands (`undo`, `add work`, `plan people time`, `notifications on`, nudge replies), then `understand()` and one branch per intent. `done()` at the end splits picture bubbles from text and pads the last bubble to three buttons. Also `unwindNudge`, `dailyDigest`, `dueReminders`, `beginChat`.
- `src/lib/understand.ts`: model first, regex fallback, merges both into `ParsedMessage`. `setUnderstandingEngine()` swaps the model call for tests.
- `src/lib/llm.ts`: provider resolution, the two zod schemas, the system prompts (`SYSTEM`, `SETUP_SYSTEM`, `FEATURES`, `VOICE`), the OpenAI-compatible call with forgiving JSON parsing (thinking models, fenced JSON, missing fields).
- `src/lib/nlp.ts`: the regex parser. `parseRange` ("7 to 10pm"), `hasDayWord`, `isStandingLanguage`, `workLabelFor`, intents.
- `src/lib/scheduler.ts`: `buildDayPlan` (events, standing hours as a weekday block, to-dos into gaps, free blocks, stats), `proposeEvent`.
- `src/lib/life.ts`: `weekView` (free windows, evenings and weekends), `suggestForFreeTime` (people-first slots), `freeLine` ("you're free from 10 pm"), `weekImage`, `dayImage`, `protectedEvent`.
- `src/lib/names.ts`: name out of a sentence.
- `src/lib/types.ts`: `UserRecord` (settings, events, todos, messages, draft, `people`, `onboarding`, `tips`, `notify`, `daysOff`, `lastNudgeDate`), `ImageCard`, `ReplyButton`.
- `src/lib/store.ts`: file store locally, Upstash/Vercel KV if `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set, otherwise **in-memory on Vercel** (see limits).
- `src/app/api/chat/route.ts`: `POST` a message, `PUT` the browser's copy of the user (with `poll: true` it also returns due reminders and the nudge), `GET` legacy poll.
- `src/app/api/session/route.ts`: name intake, starts setup with `beginChat`.
- `src/components/whatsapp/WhatsAppApp.tsx`: the WhatsApp UI (themes and wallpapers via `src/lib/theme.ts`, the 30 s poll, button actions including `notify` and calendar links).
- `src/components/whatsapp/schedule-image.tsx`: the week and day pictures as SVG (400 wide, bubble size).
- `scripts/try-bot.mjs`: drive the brain from the terminal, no server.

## Running and testing

```bash
npm install
npm run dev          # http://localhost:43177
npx tsc --noEmit     # one pre-existing LayoutProps error from Next types is fine
npx eslint src
npx tsx scripts/try-bot.mjs "9 to 5" "6pm" "mum, dad" "notifications off" "work 7 to 10pm today" "plan people time"
```

For the model locally, put `GEMINI_API_KEY=...` in `.env.local` (see `.env.example`). To force the regex fallback, `LLM_PROVIDER=off`. `try-bot` also takes `BUFFER_FAKE_LLM=path.json` for canned model answers.

On Vercel, runtime logs show which model was picked (`[buffer] google model ...`) and why a call fell back (`[buffer] model call failed ...`).

## Conventions (keep these)

- **Voice**: lowercase like a text from a friend, warm, brief, plain words. No em dashes, no emoji, no exclamation marks, never corporate, never lecturing about balance. The same rules are in `VOICE` in `llm.ts` for the model.
- **Buttons**: two or three plain words that say what happens, 20 characters max (WhatsApp's limit): *See my week*, *Mark work hours*, *Push 30 min later*, *Undo (remove it)*, *Reserve Fri evening*, *Plan people time*. Every reply ends with three buttons under its last bubble; `done()` pads from `DEFAULT_BUTTONS`, so branches only add the specific ones.
- **Pictures first**, then words. Never put hour totals in copy ("32h of weekend" was cut); say where the open stretch is instead (`freeLine`).
- **Explain once**: new concepts get one bracketed line the first time (`tip(next, "keep")`), tracked in `user.tips`.
- **Everything saves immediately** with *Undo*; no confirmation step unless something clashes.
- **The regex fallback must keep working.** Any new phrasing the model handles should have a reasonable regex fallback in `nlp.ts`, and the demo must never break with no key.
- **Adding an intent**: add it to `INTENTS` in `llm.ts` and the intent guide in `SYSTEM`, to `Intent` in `nlp.ts` (with a regex), and a branch in `processTurn`. Run `try-bot` for both paths.
- **Setup answers** are handled in `handleOnboarding` / `applySetup`, not in the intent branches. Any question can be answered out of order; `applySetup` asks the next unanswered one.
- Standing hours live in `settings.workStart/workEnd/workLabel` and appear as a block on weekdays via `buildDayPlan`; a marked work block that overlaps replaces them for that day; `daysOff` clears a day.
- Small edits: match the surrounding style (2-space indent, double quotes, long lines are fine).

## WhatsApp

`src/app/api/whatsapp/route.ts` is Meta's webhook (GET verifies, POST handles messages); `src/lib/wa.ts` turns each `ChatMessage` into WhatsApp messages (image for a picture, interactive buttons for text with up to three replies, list for the menu; browser-only buttons such as Add to Google Cal become a text with the link). `src/app/api/picture/[payload]/route.tsx` renders the day and week cards as PNG with `next/og`; the card is base64url in the URL. `src/app/api/whatsapp/tick/route.ts` sends due reminders and nudges, meant to be called every 15 minutes by the GitHub Actions workflow in `docs/tick-workflow.yml` (copy it to `.github/workflows/`; that push needs the `workflow` token scope). WhatsApp users are keyed by phone (`waPhone`, `createWhatsAppUser`) and need the Redis store, since there is no browser to hold their copy. Env: `WA_TOKEN`, `WA_PHONE_ID`, `WA_VERIFY_TOKEN`.

## Known limits and likely next steps

- **Storage**: on Vercel without KV the store is in memory, so users reset on cold starts; the chat page keeps a copy in localStorage and re-sends it, so a person's own chat survives, but nothing is shared across devices. Adding Upstash Redis (free) and setting `KV_REST_API_URL` and `KV_REST_API_TOKEN` fixes this with no code change.
- **Notifications** only fire while the tab is open (the page polls). Real background push needs a service worker, VAPID keys and a server-side scheduler, which also needs the KV store above.
- Only work/class/shift hours repeat. Other repeating plans ("gym every day") are not supported; the model says so honestly.
- Buffer does not read an existing calendar; it only writes (ICS feed).
- Ideas not built yet: timetable screenshot -> hours (needs a vision call), call streaks ("Mum, last call 9 days ago"), "both free" with a friend also on Buffer, voice notes, a Sunday recap picture.

When in doubt about a wording or a flow, run it in `try-bot` and read it as a WhatsApp message from a friend. If it would feel odd there, change it.
