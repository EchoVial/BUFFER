# Buffer

WhatsApp-style work-life chat that lands on Google, Apple, Android, and Outlook calendars.

Text Buffer like a friend (`gym tmrw 7pm`, `i want 2 hrs of social every day`, `rundown`). Locked events publish to a private ICS feed your OS calendar can subscribe to.

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
