# Buffer

WhatsApp-style assistant. You tell it when you work; it shows you when you are actually free (as a picture, not a wall of text) and nudges you, once a day after you switch off, to call the people you love. Everything you add lands on Google, Apple, Android, and Outlook calendars through a private live feed.

## First run

Four questions, with tap-to-answer buttons: when do you usually work (`9 to 5`, `7pm to 10pm`, or *It varies*), when do you switch off in the evening, who should Buffer help you make time for, and whether it may send browser notifications for the evening nudge (*Allow nudges* asks the browser once). Everything after that is plain text:

- `work 7 to 10pm today`, `shift 9 to 5 tomorrow`: marks work. No confirmation step unless it clashes with something.
- `every weekday from 9am to 5pm i have class`, `i usually work 9 to 6`, or `all weekdays` when asked which day: standing hours. They show as a block (Class, Shift or Work) on every weekday until a marked block overlaps them; `no class tomorrow` or `off friday` clears one day, `class is back on tuesday` restores it.
- `my week`, `today`, `tomorrow`: a picture. Monochrome: the week is free (white) stacked on work (grey) per day; a day is a strip plus the blocks as a list. Purple is the one accent and means "you can drag this".
- `dinner with sam friday 8pm`, `gym tomorrow 7am`: plans. `remind me to call nani`: a to-do (no time).
- `reserve friday evening` (or `keep friday evening free`): a *Reserved for you* block so nothing else gets planned there.
- `plan people time`: a slot this week for each person you named (a call for a person, an evening for a group), tap one and it is on the calendar. This is the point; marking work is what makes the slots honest, and every work reply ends with this offer.
- `undo`, `+30 min`, `make it 2h`, `move gym to 8pm`, `done with the deck`: changes in plain words.
- `nudge me to call mum`, `who do i call`: the people behind the evening nudge.

Every reply ends in three buttons, worded as what they do (See my week, Mark work hours, Push 30 min later). Each feature is explained once, in a bracketed line, the first time it appears. `help` shows the whole thing in five lines; `set up again` reruns the questions.

## What it runs on

Next.js on Vercel. The brain is whichever model the environment points at, and the app is written so that an open model on a free tier is enough:

| Set this | Model | Where to get the key |
| --- | --- | --- |
| `GROQ_API_KEY` | Llama 3.3 70B on Groq (fast, free tier) | console.groq.com |
| `GEMINI_API_KEY` | Gemma 3 27B on Google AI Studio (free tier; `LLM_MODEL=gemini-2.5-flash` for Gemini) | aistudio.google.com |
| `OPENROUTER_API_KEY` | `google/gemma-3-27b-it:free` on OpenRouter | openrouter.ai |
| `OLLAMA_MODEL=gemma3` | a local Ollama; only reachable from the machine running it, so for laptops and dev, not for Vercel | ollama.com |
| `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` | any OpenAI-compatible endpoint | |
| `ANTHROPIC_API_KEY` | Claude | console.anthropic.com |

Nothing set means the regex parser (`src/lib/nlp.ts`), which handles the button payloads and standard phrasings but nothing off script. Vercel cannot run a model itself (serverless functions have no GPU and a 250 MB limit), so a hosted endpoint is needed there; the free tiers above are enough for a demo. Keys go in Vercel: Project > Settings > Environment Variables, then redeploy. `src/lib/llm.ts` sends the same prompt and JSON schema to every provider and validates the answer with zod; a reply that does not fit falls back to the rules for that turn.

With a model set, it also reads the three setup answers (loose wording, several answers at once, side questions), writes the reply itself for chitchat, questions about Buffer or your schedule, greetings and anything it could not map to an action, adds a short opening clause to action replies when the message carried a mood or a detail, and picks up people mentioned in passing ("...and remind me to spend some time with my roommates too") into the nudge list.

## Buffer on WhatsApp

The same brain answers on real WhatsApp through Meta's Cloud API, using the free **test number** Meta gives every app, so nobody needs a second phone: up to five verified phones can chat with it. Three routes do the work:

- `POST /api/whatsapp`: Meta's webhook. Text and button taps come in, `processTurn` runs, replies go back as WhatsApp messages: pictures as PNG (`/api/picture/<card>.png`, rendered with `next/og`), text with up to three reply buttons, the menu as a list.
- `GET /api/whatsapp`: the webhook verification handshake (`WA_VERIFY_TOKEN`).
- `GET /api/whatsapp/tick`: sends due reminders, the morning digest and the evening nudge to every WhatsApp user. `docs/tick-workflow.yml` is a GitHub Actions workflow that calls it every 15 minutes; copy it to `.github/workflows/tick.yml` (pushing workflow files needs a GitHub token with the `workflow` scope, so it is not committed there directly).

Setup, in order: (1) a database, because WhatsApp users must survive server restarts: Vercel project > Storage > Create Database > Upstash Redis (free), then redeploy. (2) developers.facebook.com > Create app (type Business) > add the WhatsApp product > API Setup: copy the **Phone number ID** and a token, and add your own number under "To" (Meta sends a code to your WhatsApp). (3) In Vercel add `WA_PHONE_ID`, `WA_TOKEN`, `WA_VERIFY_TOKEN`, redeploy. (4) Meta > WhatsApp > Configuration: callback URL `https://<your-app>/api/whatsapp`, your verify token, subscribe to `messages`. (5) Message the test number from your phone. The temporary token expires after 24 hours; for a permanent one create a System User in Meta Business Settings with `whatsapp_business_messaging` and `whatsapp_business_management`.

## How it understands you

`src/lib/understand.ts` sends each message, with the user's timezone, settings, upcoming events, open to-dos, remembered facts and the last few messages, to the model (`src/lib/llm.ts`, structured output) and gets back one typed action: intent, title, date, time, length, kind, or a single clarifying question with quick-reply buttons. The scheduler (`src/lib/scheduler.ts`, `src/lib/life.ts`) then does the calendar arithmetic deterministically. Without a model the regex parser in `src/lib/nlp.ts` takes over, so the demo never breaks. Setup answers, button payloads and one-word commands (`undo`, `today`) are handled before either parser runs.

Pictures are sent as their own bubble first; the words and the three buttons follow. On the day picture a saved block (the ones with a grip mark) can be dragged along the strip in 15-minute steps; the drop lands in the chat as `move Work to 8 pm today`, Buffer shows the day as it would look and asks *Yes, move it* / *Leave it* before changing anything. The evening nudge (`unwindNudge` in `src/lib/bot.ts`) fires from the client poll (`PUT /api/chat` with the browser's copy of the user, every 30 s) once a day, in the 90 minutes after the switch-off time, only when nothing is on; with notifications allowed it also shows as a browser notification while the tab is open. On real WhatsApp this would be a scheduled job hitting the same function.

Try the brain without the UI: `npx tsx scripts/try-bot.mjs "9 to 5" "6pm" "mum, dad" "work 7 to 10pm today" "today"`.

## Git

This project is meant to live in a Git repo (already initialized on `main`). To deploy on Vercel with automatic deploys, put it on GitHub, GitLab, or Bitbucket:

```bash
git remote add github https://github.com/YOUR_USER/buffer.git
git push -u github main
```

If you opened this from a Cursor new-project session, use **Create repo** in the agent view, then import that repo in Vercel.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:43177](http://localhost:43177).

- Site: `/`
- Chat: `/chat` — first message is your name (that’s the account)

There is no Admin link in the UI. Open the console by changing the URL to `/admin`.

## Deploy on Vercel

Standard Next.js App Router app. No custom build command.

1. Push this repo to GitHub (or GitLab / Bitbucket).
2. Go to [vercel.com/new](https://vercel.com/new) and **Import** the repository.
3. Framework: **Next.js**. Root directory: `.`
4. Set environment variables **before** the first production deploy:

   | Name | Required | Notes |
   | --- | --- | --- |
   | `ADMIN_PASSWORD` | Yes on Vercel | Password for `/admin`. If this is missing on Vercel, `/admin` stays locked. |
   | `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Optional | Vercel KV / Upstash so chats survive deploys. |
   | `GROQ_API_KEY` or `GEMINI_API_KEY` (or another provider, see "What it runs on") | Recommended | The model that does the natural-language understanding. Without one Buffer uses the rule-based parser. |

5. Deploy. Chat: `https://your-project.vercel.app/chat`. Console: change the path to `/admin`.

CLI from this folder:

```bash
npx vercel
npx vercel --prod
npx vercel env add ADMIN_PASSWORD
```

Optional durable storage: in the Vercel project, add **KV** (or Upstash Redis). That injects the REST env vars. Redeploy.

Calendar subscribe links use the deployment’s public `https` origin automatically.

## Console (`/admin`)

Not linked from the site. Type `/admin` in the address bar.

- **Local:** password `balance123` unless `ADMIN_PASSWORD` is in `.env.local`.
- **Vercel:** the `ADMIN_PASSWORD` env var. Add it for Production (and Preview if you want the console there too).

After login, the browser keeps the session until you click **Lock**.

You can create users by name, inspect chat JSON, reset or delete a person, and change default wake/work/social caps.

## Persistence

- **Local:** `data/store.json` plus the browser cache.
- **Vercel without KV:** memory on the current instance plus each person’s browser cache. Deploys can clear server-side users.
- **Vercel with KV:** the same store in Redis, so users, chats, and calendar feeds last across deploys.

## Calendar

The live feed is `/api/calendar/<secret-token>/feed.ics`. Treat it like a password. Outlook subscribe-from-web needs a public **https** URL (not localhost).
