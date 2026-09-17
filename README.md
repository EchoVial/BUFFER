# Buffer

A website for work-life chat that actually lands on the calendar your OS already uses.

Text **Buffer** like a friend (`gym tmrw 7pm`, `i want 2 hrs of social every day`, `rundown`). Locked events publish to a private ICS feed. Google Calendar, Apple Calendar, Android (via Google), and Outlook subscribe to that feed — browsers are not allowed to write silently into those apps.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:43177](http://localhost:43177).

- **Site + OS calendars:** `/`
- **Chat:** `/chat` — first message is your name (that’s the account)
- **Admin:** `/admin`

## Connect a calendar

1. Open chat and send your name.
2. Tap **Connect calendar** (or say `connect calendar`), or use the same panel on the home page once you’re signed in.
3. Pick the calendar for this device:

   | OS / app | What happens |
   | --- | --- |
   | **Google / Android** | Opens Google Calendar with your live feed (`cid=`). You can also paste the HTTPS URL under Settings → Add calendar → From URL. |
   | **iPhone, iPad, Mac** | Opens `webcal://…` so Calendar.app can subscribe. |
   | **Windows / Outlook** | On a public **https** site, opens Outlook’s subscribe-from-web with a `.ics` feed. Locally, Outlook cannot fetch `localhost`, so Buffer copies the URL, downloads `.ics`, and opens an Outlook event compose for the latest locked item. You can also paste the feed in Outlook → Add calendar → Subscribe from web. |
   | **Any** | Copy the private ICS URL, or download a one-off `.ics` snapshot. |

The feed is `/api/calendar/<secret-token>/feed.ics`. Treat it like a password: anyone with the URL can read your schedule. Calendar apps typically refresh every 15 minutes.

A website still cannot inject events into Google/Apple/Android without that subscribe (or a one-shot template / file). That is an OS rule, not a missing feature.

## Deploy on Vercel

This is a standard Next.js app. No extra build command is required.

1. Push this project to GitHub (or GitLab / Bitbucket).
2. Go to [vercel.com/new](https://vercel.com/new) and **Import** the repo.
3. Framework preset: **Next.js**. Root directory: `.` Leave build/output empty (Vercel detects them).
4. Add environment variables **before** the first deploy:

   | Name | Value | Notes |
   | --- | --- | --- |
   | `ADMIN_PASSWORD` | a long secret you choose | **Required on Vercel.** Without it, `/admin` stays locked. |

5. Click **Deploy**. Your site will be at `https://your-project.vercel.app`.

Optional, for chats that survive deploys and multiple serverless instances:

- In the Vercel dashboard, add **KV** (or Upstash Redis) to the project.
- That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` pair). Redeploy.

Calendar subscribe URLs use the public origin of the deployment. On Vercel that is automatic from the request host.

CLI alternative from this folder:

```bash
npx vercel
```

Log in, link a project, then `npx vercel --prod`. Set `ADMIN_PASSWORD` with `npx vercel env add ADMIN_PASSWORD`.

### After deploy

- Site: `https://your-project.vercel.app`
- Chat: `https://your-project.vercel.app/chat`
- Admin: `https://your-project.vercel.app/admin`

## Admin access

1. Open **`/admin`** (there is also an **Admin** link in the site header and chat).
2. Enter the password:
   - **Local:** `balance123` unless you set `ADMIN_PASSWORD` in `.env.local`.
   - **Vercel:** the value you put in **Project → Settings → Environment Variables → `ADMIN_PASSWORD`**. Production, Preview, and Development should all have it if you want admin on every URL.
3. After a correct login, the session is kept in this browser (`sessionStorage`) until you click **Lock**.

### What you can do in admin

- **Create users** with the exact name they will type in chat (e.g. `Jordan`). If **Auto-create users** is on, they can also join just by sending their name.
- Inspect full chat JSON, reset or delete a person, and see the last NLP parse.
- Change default wake/work/social caps for new accounts.

If the password is wrong, or `ADMIN_PASSWORD` is missing on Vercel, the API returns 401 and the login form shows the error.

## Persistence

- **Local:** `data/store.json` plus the browser cache.
- **Vercel without KV:** in-memory on the current instance, plus each person’s browser cache. Fine for a demo; deploys can clear server-side users (and their calendar tokens).
- **Vercel with KV:** the same store is written to Redis, so admin-created users, chats, and calendar feeds last across deploys.

## What it does

- Plan events in everyday slang, with WhatsApp-style reply buttons and option lists
- Overlap warnings, daily rundown, to-do hierarchy, social-hour rules
- Live ICS subscribe for Google, Apple, Android, and Outlook, plus one-shot Google template / `.ics` download
