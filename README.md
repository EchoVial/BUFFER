# Buffer

WhatsApp-style assistant. You tell it when you work; it shows you when you are actually free (as a picture, not a wall of text) and nudges you, once a day after you switch off, to call the people you love. Everything you add lands on Google, Apple, Android, and Outlook calendars through a private live feed.

## First run

Three questions, with tap-to-answer buttons: when do you usually work (`9 to 5`, `7pm to 10pm`, or *It varies*), when do you switch off in the evening, and who should Buffer nudge you to call. Everything after that is plain text:

- `work 7 to 10pm today`, `shift 9 to 5 tomorrow`: marks work. No confirmation step unless it clashes with something.
- `my week`, `today`, `tomorrow`: a picture. The week is free (green) stacked on work (grey) per day; a day is a strip plus the blocks as a list.
- `dinner with sam friday 8pm`, `gym tomorrow 7am`: plans. `remind me to call nani`: a to-do (no time).
- `reserve friday evening` (or `keep friday evening free`): a *Reserved for you* block so nothing else gets planned there.
- `undo`, `+30 min`, `make it 2h`, `move gym to 8pm`, `done with the deck`: changes in plain words.
- `nudge me to call mum`, `who do i call`: the people behind the evening nudge.

Every reply ends in three buttons, worded as what they do (See my week, Mark work hours, Push 30 min later). Each feature is explained once, in a bracketed line, the first time it appears. `help` shows the whole thing in five lines; `set up again` reruns the questions.

## What it runs on

Next.js on Vercel. The brain is Claude (`claude-opus-5`, structured outputs) when `ANTHROPIC_API_KEY` is set in the Vercel project's environment variables. Without the key the app falls back to a regex parser, which handles the button payloads and the standard phrasings but nothing off script. The key is set in Vercel: Project > Settings > Environment Variables > `ANTHROPIC_API_KEY`, then redeploy.

With the key, Claude also reads the three setup answers (loose wording, several answers at once, side questions), writes the reply itself for chitchat, questions about Buffer or your schedule, greetings and anything it could not map to an action, adds a short opening clause to action replies when the message carried a mood or a detail, and picks up people mentioned in passing ("...and remind me to spend some time with my roommates too") into the nudge list.

## How it understands you

`src/lib/understand.ts` sends each message, with the user's timezone, settings, upcoming events, open to-dos, remembered facts and the last few messages, to Claude (`src/lib/llm.ts`, structured output) and gets back one typed action: intent, title, date, time, length, kind, or a single clarifying question with quick-reply buttons. The scheduler (`src/lib/scheduler.ts`, `src/lib/life.ts`) then does the calendar arithmetic deterministically. Set `ANTHROPIC_API_KEY`; without it the regex parser in `src/lib/nlp.ts` takes over, so the demo never breaks. Setup answers, button payloads and one-word commands (`undo`, `today`) are handled before either parser runs.

The evening nudge (`unwindNudge` in `src/lib/bot.ts`) fires from the client poll (`GET /api/chat`) once a day, in the 90 minutes after the switch-off time, only when nothing is on. On real WhatsApp this would be a scheduled job hitting the same function.

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
   | `ANTHROPIC_API_KEY` | Recommended | Claude does the natural-language understanding. Without it Buffer uses the rule-based parser. |

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
