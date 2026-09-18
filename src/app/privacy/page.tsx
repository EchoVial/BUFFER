import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Buffer privacy policy",
  description: "What Buffer keeps, where it goes, and how to delete it.",
};

const UPDATED = "19 September 2026";

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px 80px", lineHeight: 1.6, fontSize: 16 }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/">Buffer</Link>
      </p>
      <h1 style={{ fontSize: 30, marginBottom: 4 }}>Privacy policy</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>Last updated {UPDATED}</p>

      <p>
        Buffer is a student project: a chat assistant that keeps track of when you work so it can show you when you are free and nudge you to spend
        some of that time with people you care about. It runs as a web chat and as a WhatsApp bot. This page says what it stores and what it does
        with it, in plain words.
      </p>

      <h2>What Buffer keeps</h2>
      <ul>
        <li>The name you give it, or your WhatsApp profile name.</li>
        <li>On WhatsApp, your phone number, so it knows which conversation is yours and where to reply.</li>
        <li>The messages you send it and the replies it gives.</li>
        <li>What you tell it about your time: work or class hours, when you switch off, plans, to-dos, and the people you want to make time for.</li>
        <li>Settings such as your time zone and whether you allowed browser notifications.</li>
      </ul>

      <h2>Where it goes</h2>
      <ul>
        <li>
          <strong>Storage</strong>: your record is kept in a Redis database (Upstash) attached to the app&apos;s hosting on Vercel. In the web chat, your browser also
          keeps a copy so the conversation survives restarts.
        </li>
        <li>
          <strong>Understanding</strong>: each message you send, with the context needed to understand it (your settings, upcoming plans, the last few
          messages), is sent to a language model to work out what you meant. Depending on how the deployment is configured this is Google (Gemini or
          Gemma) or Anthropic (Claude). The model returns a structured reading of your message; Buffer does not use your messages to train anything.
        </li>
        <li>
          <strong>WhatsApp</strong>: if you talk to Buffer on WhatsApp, your messages pass through Meta&apos;s WhatsApp Business Platform like any WhatsApp
          message, and Buffer&apos;s replies go back the same way.
        </li>
        <li>
          <strong>Calendars</strong>: only if you choose to. &quot;Add to Google Cal&quot; opens Google Calendar with the event filled in for you to save; &quot;Connect
          live feed&quot; gives you a private link that your calendar app fetches. Buffer never reads your existing calendar.
        </li>
      </ul>

      <h2>What Buffer does not do</h2>
      <ul>
        <li>It does not sell or share your data with advertisers.</li>
        <li>It does not message anyone but you, and on WhatsApp it can only message numbers that were added to its test list.</li>
        <li>It does not read your contacts, location, photos or your existing calendar.</li>
      </ul>

      <h2>Deleting your data</h2>
      <p>
        In the web chat, the menu (⋮) has &quot;Leave chat&quot;, which forgets your record. On WhatsApp, send <strong>delete my data</strong> or email the address
        below and your record is removed. Data for the WhatsApp test number is also removed when the test number is retired.
      </p>

      <h2>Contact</h2>
      <p>
        Buffer is built by students at BITS Pilani as coursework. Questions or deletion requests: <a href="mailto:zvezdarq@gmail.com">zvezdarq@gmail.com</a>.
      </p>
    </main>
  );
}
