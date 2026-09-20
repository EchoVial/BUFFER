import type { ChatMessage, ImageCard, ReplyButton, UserRecord } from "./types";
import { googleCalendarUrl, googleSubscribeUrl } from "./calendar";

/**
 * WhatsApp Cloud API (Meta's own, free with a test number). The same
 * ChatMessage the web chat renders becomes: an image message for a picture,
 * an interactive "button" message for text with up to three replies, an
 * interactive "list" message for the menu, plain text otherwise.
 *
 * Env: WA_TOKEN (access token), WA_PHONE_ID (the test number's Phone number ID),
 * WA_VERIFY_TOKEN (any string you also type into Meta's webhook form).
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export function waConfigured(): boolean {
  return Boolean(process.env.WA_TOKEN && process.env.WA_PHONE_ID);
}

/** Meta's error code from the last failed send in this instance (131047 = outside the 24-hour window). */
export let lastSendError: { code?: number; message?: string } | undefined;

async function post(payload: Record<string, unknown>): Promise<boolean> {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  if (!token || !phoneId) return false;
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const err = (JSON.parse(text) as { error?: { code?: number; message?: string } }).error;
      lastSendError = { code: err?.code, message: err?.message };
    } catch {
      lastSendError = { message: text.slice(0, 200) };
    }
    console.warn("[buffer] whatsapp send failed", res.status, text.slice(0, 400));
    return false;
  }
  lastSendError = undefined;
  return true;
}

/**
 * The WhatsApp Business Account this number belongs to: WA_WABA_ID, else the
 * one the token was granted, else the account this project was built on.
 */
export async function wabaId(): Promise<string | undefined> {
  if (process.env.WA_WABA_ID) return process.env.WA_WABA_ID;
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  if (!token || !phoneId) return undefined;
  try {
    const me = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = me.ok ? ((await me.json()) as { data?: { granular_scopes?: Array<{ target_ids?: string[] }> } }).data : undefined;
    for (const scope of data?.granular_scopes ?? []) {
      for (const id of scope.target_ids ?? []) {
        const r = await fetch(`${GRAPH}/${id}/phone_numbers?fields=id`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok && ((await r.json()) as { data?: Array<{ id: string }> }).data?.some((p) => p.id === phoneId)) return id;
      }
    }
  } catch {
    /* fall through */
  }
  return "1653068239572676";
}

/**
 * A message template for reaching someone after WhatsApp's 24-hour window has
 * closed (free-form messages bounce with 131047 then). Created on first use;
 * Meta approves utility templates in minutes. Returns its status.
 */
export async function ensureTemplate(name: string, body: string, example: string[]): Promise<"APPROVED" | "PENDING" | "REJECTED" | "MISSING"> {
  const token = process.env.WA_TOKEN;
  const waba = await wabaId();
  if (!token || !waba) return "MISSING";
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const have = await fetch(`${GRAPH}/${waba}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,language`, { headers });
  if (have.ok) {
    const found = ((await have.json()) as { data?: Array<{ name: string; status: string }> }).data?.find((t) => t.name === name);
    if (found) return found.status === "APPROVED" ? "APPROVED" : found.status === "REJECTED" ? "REJECTED" : "PENDING";
  }
  const res = await fetch(`${GRAPH}/${waba}/message_templates`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name,
      language: "en_US",
      category: "UTILITY",
      components: [{ type: "BODY", text: body, example: { body_text: [example] } }],
    }),
  });
  if (!res.ok) {
    console.warn("[buffer] template create failed", res.status, (await res.text()).slice(0, 300));
    return "MISSING";
  }
  const created = (await res.json()) as { status?: string };
  return created.status === "APPROVED" ? "APPROVED" : "PENDING";
}

export function sendTemplate(to: string, name: string, params: string[]) {
  return post({
    to,
    type: "template",
    template: {
      name,
      language: { code: "en_US" },
      components: params.length ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }] : [],
    },
  });
}

export async function markRead(messageId: string): Promise<void> {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  if (!token || !phoneId) return;
  await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  }).catch(() => undefined);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function sendText(to: string, body: string) {
  return post({ to, type: "text", text: { body: clip(body, 4096), preview_url: false } });
}

export function sendButtons(to: string, body: string, buttons: Array<{ id: string; title: string }>) {
  return post({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: clip(body, 1024) },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: clip(b.id, 256), title: clip(b.title, 20) } })) },
    },
  });
}

export function sendList(to: string, body: string, button: string, sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>, footer?: string) {
  let budget = 10;
  const trimmed = sections
    .map((s) => {
      const rows = s.rows.slice(0, Math.max(0, budget)).map((r) => ({ id: clip(r.id, 200), title: clip(r.title, 24), ...(r.description ? { description: clip(r.description, 72) } : {}) }));
      budget -= rows.length;
      return { title: clip(s.title, 24), rows };
    })
    .filter((s) => s.rows.length);
  return post({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: clip(body, 1024) },
      ...(footer ? { footer: { text: clip(footer, 60) } } : {}),
      action: { button: clip(button, 20), sections: trimmed },
    },
  });
}

/**
 * Pictures go up to Meta first and are sent by id, so the render time is spent
 * before anything is sent and the picture lands before the words that follow it.
 * (Sending by link makes Meta fetch the PNG after the text has already gone out.)
 */
export async function sendImage(to: string, link: string, caption?: string) {
  const caption_ = caption ? { caption: clip(caption, 1024) } : {};
  const id = await uploadMedia(link);
  if (id) return post({ to, type: "image", image: { id, ...caption_ } });
  return post({ to, type: "image", image: { link, ...caption_ } });
}

async function uploadMedia(link: string): Promise<string | undefined> {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  if (!token || !phoneId) return undefined;
  try {
    const png = await fetch(link);
    if (!png.ok) return undefined;
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "image/png");
    form.append("file", new Blob([await png.arrayBuffer()], { type: "image/png" }), "buffer.png");
    const res = await fetch(`${GRAPH}/${phoneId}/media`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    if (!res.ok) {
      console.warn("[buffer] whatsapp media upload failed", res.status, (await res.text()).slice(0, 300));
      return undefined;
    }
    return ((await res.json()) as { id?: string }).id;
  } catch (err) {
    console.warn("[buffer] whatsapp media upload failed", err instanceof Error ? err.message : err);
    return undefined;
  }
}

let ownNumber: Promise<string | undefined> | undefined;

/** The number people are talking to, as Meta shows it ("+1 555-159-9246"). */
export function botNumber(): Promise<string | undefined> {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  if (!token || !phoneId) return Promise.resolve(undefined);
  ownNumber ??= fetch(`${GRAPH}/${phoneId}?fields=display_phone_number`, { headers: { Authorization: `Bearer ${token}` } })
    .then(async (r) => (r.ok ? ((await r.json()) as { display_phone_number?: string }).display_phone_number : undefined))
    .catch(() => undefined);
  return ownNumber;
}

/**
 * A contact card for Buffer itself. Saving it is the one way a test number
 * can show up as "Buffer" instead of digits in the chat header.
 */
export async function sendContact(to: string, origin: string) {
  const number = await botNumber();
  if (!number) return false;
  return post({
    to,
    type: "contacts",
    contacts: [
      {
        name: { formatted_name: "Buffer", first_name: "Buffer" },
        org: { company: "Buffer" },
        phones: [{ phone: number, type: "WORK", wa_id: number.replace(/\D/g, "") }],
        urls: [{ url: origin, type: "WORK" }],
      },
    ],
  });
}

/** The picture as a PNG the WhatsApp servers can fetch: the card itself travels in the URL. */
export function pictureUrl(origin: string, card: ImageCard): string {
  const payload = Buffer.from(JSON.stringify(card), "utf8").toString("base64url");
  return `${origin}/api/picture/${payload}.png`;
}

/**
 * Buttons that only make sense in a browser become text with a link (or vanish);
 * the rest keep their payload as the reply id, which comes straight back as the user's text.
 */
function translateButtons(user: UserRecord, msg: ChatMessage, origin: string): { buttons: Array<{ id: string; title: string }>; extraText: string[] } {
  const extraText: string[] = [];
  const buttons: Array<{ id: string; title: string }> = [];
  const tz = user.settings.timezone || "UTC";
  const ev = user.events.find((e) => e.id === msg.calendarEventId) ?? user.events[user.events.length - 1];
  for (const b of msg.buttons ?? []) {
    switch (b.action) {
      case "google-cal":
        if (ev) extraText.push(`add *${ev.title}* to google calendar (tap, then Save):\n${googleCalendarUrl(ev, tz)}`);
        break;
      case "connect-feed":
        if (user.calendarToken) extraText.push(`subscribe google calendar to everything i save:\n${googleSubscribeUrl(origin, user.calendarToken)}`);
        break;
      case "ics":
      case "outlook-cal":
      case "notify":
        break;
      default: {
        const payload = (b.payload || b.title).trim();
        buttons.push({ id: payload || b.title, title: b.title });
      }
    }
  }
  return { buttons, extraText };
}

/** Send one reply as WhatsApp messages. */
export async function deliver(user: UserRecord, msg: ChatMessage, origin: string): Promise<void> {
  const to = user.waPhone;
  if (!to) return;
  const text = msg.text.trim();
  if (msg.card?.type === "image") {
    await sendImage(to, pictureUrl(origin, msg.card), text || undefined);
    if (!text && !msg.buttons?.length && !msg.list) return;
    if (!msg.buttons?.length && !msg.list) return;
  }
  const cardText = msg.card && msg.card.type !== "image" ? cardAsText(msg.card) : "";
  const body = [text, cardText].filter(Boolean).join("\n\n") || " ";
  if (msg.list) {
    await sendList(
      to,
      body,
      msg.list.button,
      msg.list.sections.map((s) => ({ title: s.title, rows: s.rows.map((r) => ({ id: r.payload.trim() || r.title, title: r.title, description: r.description })) })),
      msg.list.footer,
    );
    return;
  }
  const { buttons, extraText } = translateButtons(user, msg, origin);
  if (msg.card?.type === "image") {
    // The picture went out on its own; the words already rode along as its caption.
    if (buttons.length) await sendButtons(to, body === " " ? "what next?" : body, buttons);
  } else if (buttons.length) {
    await sendButtons(to, body, buttons);
  } else {
    await sendText(to, body);
  }
  for (const t of extraText) await sendText(to, t);
}

function cardAsText(card: Exclude<ChatMessage["card"], undefined | ImageCard>): string {
  if (card.type === "todos") return card.lines.join("\n");
  if (card.type === "overlaps") return card.items.map((i) => `• ${i}`).join("\n");
  if (card.type === "schedule") return card.lines.join("\n");
  if (card.type === "proposal") return [card.eventPreview, ...card.moves.map((m) => `• ${m}`)].join("\n");
  return "";
}

/** Rough time zone from the country code, until the person says otherwise. */
export function timezoneForPhone(phone: string): string {
  if (phone.startsWith("91")) return "Asia/Kolkata";
  if (phone.startsWith("44")) return "Europe/London";
  if (phone.startsWith("1")) return "America/New_York";
  if (phone.startsWith("61")) return "Australia/Sydney";
  if (phone.startsWith("65")) return "Asia/Singapore";
  if (phone.startsWith("971")) return "Asia/Dubai";
  if (phone.startsWith("49")) return "Europe/Berlin";
  if (phone.startsWith("33")) return "Europe/Paris";
  return "UTC";
}

/** A WhatsApp button reply keeps the button's id (our payload) as the message. */
export function incomingText(message: WaMessage): string | null {
  if (message.type === "text") return message.text?.body?.trim() || null;
  if (message.type === "interactive") {
    const r = message.interactive?.button_reply ?? message.interactive?.list_reply;
    return r?.id?.trim() || r?.title?.trim() || null;
  }
  if (message.type === "button") return message.button?.payload?.trim() || message.button?.text?.trim() || null;
  if (message.type === "contacts") {
    // A shared contact: "contact card: Mum 919876543210". The bot files the number under that person.
    const c = message.contacts?.[0];
    const digits = (c?.phones?.[0]?.wa_id || c?.phones?.[0]?.phone || "").replace(/\D/g, "");
    const name = (c?.name?.formatted_name || c?.name?.first_name || "").trim();
    if (digits && name) return `contact card: ${name} ${digits}`;
  }
  return null;
}

export interface WaMessage {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  button?: { payload?: string; text?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
  contacts?: Array<{ name?: { formatted_name?: string; first_name?: string }; phones?: Array<{ phone?: string; wa_id?: string }> }>;
}

export interface WaWebhook {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: WaMessage[];
        statuses?: unknown[];
      };
    }>;
  }>;
}

export type { ReplyButton };
