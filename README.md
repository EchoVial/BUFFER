# Balance

WhatsApp-style web chat for workaholics who still want a life. You text **Balance** the way you’d text a friend (`gym tmrw 7pm`, `i want 2 hrs of social every day`, `rundown`) and it plans events, stacks hierarchical to-dos, flags overlaps, and shows how the day reshuffles before anything is locked.

## Run locally

```bash
npm install
npm run dev -- --port 43177
```

Open [http://localhost:43177](http://localhost:43177). The bot asks your name first. That name is your account — chat history, events, to-dos, and personal rules stay attached to it.

Admin console: [http://localhost:43177/admin](http://localhost:43177/admin)

- Default password: `balance123`
- Override with env `ADMIN_PASSWORD`

## What it does

- Plan events in everyday slang (`lunch w sam friday at 1`, `mtg tmr 3pm 45m`)
- Ask for missing details, then show a **before / after** schedule and what to-dos have to move
- Overlap warnings and a daily rundown
- To-do hierarchy (`remind me to ship the deck p0`, `add under deck: dump outline 30m`)
- Life rules as chat (`i want 2 hours of social every day`, `i work 9 to 6`, `no work after 7pm`)
- Reminders ~15 minutes before events while the tab is open
- Admin: create users, inspect chats, reset data, tune default parameters, view last NLP parse

## Persistence

Each user’s thread is stored on the server (`data/store.json` locally) and mirrored in the browser so a refresh doesn’t wipe the chat. On Vercel the filesystem is ephemeral, so the in-memory store plus browser cache keep a session alive; for durable multi-instance storage, point this at a database later.

If **Auto-create users** is off in Admin, only names you create there can sign in.

## Deploy

Connect the repo to Vercel (or `npx vercel`). Set `ADMIN_PASSWORD` in project env vars.
