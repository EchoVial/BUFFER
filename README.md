# Buffer

WhatsApp-style assistant that finds the free time in your week and keeps it for the rest of your life: people, movement, rest. Work fits around that, not the other way round. Everything you lock lands on Google, Apple, Android, and Outlook calendars through a private live feed.

Text Buffer like a friend: `how's my week`, `keep thursday evening free`, `what should i do this weekend`, `gym tmrw 7pm`, `remind me to send the deck`, `rundown`.

## How it understands you

`src/lib/understand.ts` sends each message, with the user's timezone, settings, upcoming events, open to-dos, remembered facts and the last few messages, to Claude (`src/lib/llm.ts`, structured output) and gets back one typed action: intent, title, date, time, length, kind, or a single clarifying question with quick-reply buttons. The scheduler (`src/lib/scheduler.ts`, `src/lib/life.ts`) then does the calendar arithmetic deterministically. Set `ANTHROPIC_API_KEY`; without it the old regex parser in `src/lib/nlp.ts` takes over, so the demo never breaks.

Life-first features: `how's my week` (free time per day, best windows), `what should i do with my free time` (ideas placed into real gaps, shaped by what the week is missing), `protect thursday evening` (a held block that work cannot be scheduled over), and a once-a-day morning digest with an offer to hold the best window.

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
