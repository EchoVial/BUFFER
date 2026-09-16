# Balance

WhatsApp-style web chat for workaholics who still want a life. You text **Balance** the way you’d text a friend (`gym tmrw 7pm`, `i want 2 hrs of social every day`, `rundown`) and it plans events, stacks hierarchical to-dos, flags overlaps, and can hand locked events to Google Calendar or an Apple/Android `.ics` file.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:43177](http://localhost:43177). The bot asks your name first. That name is your account.

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

CLI alternative from this folder:

```bash
npx vercel
```

Log in, link a project, then `npx vercel --prod`. Set `ADMIN_PASSWORD` with `npx vercel env add ADMIN_PASSWORD`.

### After deploy

- Chat: `https://your-project.vercel.app`
- Admin: `https://your-project.vercel.app/admin`

## Admin access

1. Open **`/admin`** (there is also an **Admin** link in the chat header).
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
- **Vercel without KV:** in-memory on the current instance, plus each person’s browser cache. Fine for a demo; deploys can clear server-side users.
- **Vercel with KV:** the same store is written to Redis, so admin-created users and chats last across deploys.

## What it does

- Plan events in everyday slang, with WhatsApp-style reply buttons and option lists
- Overlap warnings, daily rundown, to-do hierarchy, social-hour rules
- Calendar export: Google Calendar link or Apple/Android `.ics` (phones do not allow silent writes)
