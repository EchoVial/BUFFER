import { CalendarEvent, EventKind, NlpDebug, TodoPriority, UserRecord } from "./types";
import { addDaysISO, dateISO, hmToMinutes, minutesToHM, nowInZone, weekdayIndex } from "./time";
import { findNamedItem, hintFromText } from "./match";

export type Intent =
  | "greet"
  | "help"
  | "schedule"
  | "todos"
  | "complete_todo"
  | "add_event"
  | "add_todo"
  | "set_pref"
  | "confirm"
  | "cancel"
  | "overlaps"
  | "status"
  | "chitchat"
  | "calendar"
  | "calendar_connected"
  | "options"
  | "star"
  | "unstar"
  | "edit_item"
  | "reshuffle"
  | "unknown";

export interface ParsedMessage {
  intent: Intent;
  normalized: string;
  event: Partial<CalendarEvent> & { timeUnknown?: boolean };
  todo: {
    title?: string;
    priority?: TodoPriority;
    estimatedMinutes?: number;
    parentHint?: string;
    kind?: EventKind;
    dueDate?: string;
    doneHint?: string;
    items?: string[];
  };
  prefs: Partial<{
    socialMinutesPerDay: number;
    maxWorkMinutesPerDay: number;
    wakeTime: string;
    sleepTime: string;
    workStart: string;
    workEnd: string;
    noWorkAfter: string | null;
    protectEveningsAfter: string;
  }>;
  confirm: boolean;
  cancel: boolean;
  renameTo?: string;
  targetHint?: string;
  notes: string[];
  debug: NlpDebug;
}

const SLANG: Array<[RegExp, string]> = [
  [/\btmrw\b/g, "tomorrow"],
  [/\btmr\b/g, "tomorrow"],
  [/\btomoz\b/g, "tomorrow"],
  [/\btmoro\b/g, "tomorrow"],
  [/\btomorroww\b/g, "tomorrow"],
  [/\btdy\b/g, "today"],
  [/\b2nite\b/g, "tonight"],
  [/\b2night\b/g, "tonight"],
  [/\bnite\b/g, "night"],
  [/\bwanna\b/g, "want to"],
  [/\bgonna\b/g, "going to"],
  [/\bgotta\b/g, "got to"],
  [/\blemme\b/g, "let me"],
  [/\bidk\b/g, "i don't know"],
  [/\bnvm\b/g, "never mind"],
  [/\bpls\b/g, "please"],
  [/\bplz\b/g, "please"],
  [/\burn\b/g, "your"],
  [/\brn\b/g, "right now"],
  [/\basap\b/g, "as soon as possible"],
  [/\beod\b/g, "end of day"],
  [/\beow\b/g, "end of week"],
  [/\bmtg\b/g, "meeting"],
  [/\bmtng\b/g, "meeting"],
  [/\bappt\b/g, "appointment"],
  [/\bcal\b/g, "call"],
  [/\bw\/\b/g, "with"],
  [/\bcuz\b/g, "because"],
  [/\bbc\b/g, "because"],
  [/\bdef\b/g, "definitely"],
  [/\bfr\b/g, "for real"],
  [/\btbh\b/g, "to be honest"],
  [/\bngl\b/g, "honestly"],
  [/\blmk\b/g, "let me know"],
  [/\bhmu\b/g, "hang out"],
  [/\bty\b/g, "thanks"],
  [/\bthx\b/g, "thanks"],
  [/\btysm\b/g, "thanks"],
  [/\bnp\b/g, "no problem"],
  [/\bbet\b/g, "yes"],
  [/\big\b/g, "i guess"],
  [/\byep\b/g, "yes"],
  [/\byeh\b/g, "yes"],
  [/\byea\b/g, "yes"],
  [/\byeah\b/g, "yes"],
  [/\byah\b/g, "yes"],
  [/\bnah\b/g, "no"],
  [/\bnope\b/g, "no"],
  [/\bnaw\b/g, "no"],
  [/\bokies\b/g, "ok"],
  [/\bokie\b/g, "ok"],
  [/\bkk\b/g, "ok"],
  [/\bhrs\b/g, "hours"],
  [/\bhr\b/g, "hour"],
  [/\bmins\b/g, "minutes"],
  [/\bmin\b/g, "minute"],
  [/\bhalf an hour\b/g, "30 minutes"],
  [/\bhalf hour\b/g, "30 minutes"],
  [/\ban hour\b/g, "1 hour"],
  [/\ba hour\b/g, "1 hour"],
];

function normalize(raw: string): string {
  let t = raw.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  t = t.replace(/w\//g, "with ");
  for (const [re, to] of SLANG) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const WEEK_SHORT: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
};

function parseDate(text: string, tz: string): { date?: string; note?: string } {
  const now = nowInZone(tz);
  const today = dateISO(now);
  if (/\btoday\b|\bright now\b|\blater today\b/.test(text)) return { date: today };
  if (/\btomorrow\b/.test(text)) return { date: addDaysISO(today, 1) };
  if (/\btonight\b|\bthis night\b/.test(text)) return { date: today, note: "tonight" };
  if (/\bthis evening\b/.test(text)) return { date: today, note: "evening" };
  if (/\bthis morning\b/.test(text)) return { date: today, note: "morning" };
  if (/\bthis afternoon\b/.test(text)) return { date: today, note: "afternoon" };
  if (/\bthis weekend\b/.test(text)) {
    const day = weekdayIndex(today);
    const add = day === 6 ? 0 : day === 0 ? 0 : 6 - day;
    return { date: addDaysISO(today, add || (day === 0 ? 0 : 6 - day)) };
  }
  if (/\bnext week\b/.test(text)) return { date: addDaysISO(today, 7) };
  const nextDay = text.match(
    /\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/,
  );
  if (nextDay) {
    const token = nextDay[1];
    const target =
      WEEKDAYS.indexOf(token) >= 0 ? WEEKDAYS.indexOf(token) : WEEK_SHORT[token];
    const current = weekdayIndex(today);
    let delta = (target - current + 7) % 7;
    if (delta === 0 && /next/.test(text)) delta = 7;
    if (delta === 0) delta = 7;
    return { date: addDaysISO(today, delta) };
  }
  const md = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (md) {
    const a = Number(md[1]);
    const b = Number(md[2]);
    const y = md[3] ? Number(md[3].length === 2 ? `20${md[3]}` : md[3]) : now.getFullYear();
    const monthFirst = a <= 12 ? a : b;
    const day = a <= 12 ? b : a;
    return {
      date: `${y}-${String(monthFirst).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    };
  }
  return {};
}

function parseTime(text: string): { start?: string; note?: string } {
  const mer = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (mer) {
    let h = Number(mer[1]);
    const m = Number(mer[2] || 0);
    const ap = mer[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return { start: minutesToHM(h * 60 + m) };
  }
  const mil = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (mil) return { start: `${mil[1].padStart(2, "0")}:${mil[2]}` };
  if (/\bnoon\b|\bmidday\b/.test(text)) return { start: "12:00" };
  if (/\bmidnight\b/.test(text)) return { start: "00:00" };
  if (/\bmorning\b/.test(text)) return { start: "09:00", note: "morning" };
  if (/\bafternoon\b/.test(text)) return { start: "14:00", note: "afternoon" };
  if (/\bevening\b/.test(text)) return { start: "18:30", note: "evening" };
  if (/\btonight\b|\bnight\b/.test(text)) return { start: "19:30", note: "night" };
  if (/\bend of day\b/.test(text)) return { start: "17:00", note: "eod" };
  const atBare = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (atBare) {
    let h = Number(atBare[1]);
    const m = Number(atBare[2] || 0);
    if (h < 8) h += 12;
    return { start: minutesToHM(h * 60 + m) };
  }
  return {};
}

function parseDuration(text: string): number | undefined {
  const hm = text.match(/\b(\d+(?:\.\d+)?)\s*(?:hours|hour|hrs|hr|h)\b/);
  const mm = text.match(/\b(\d+)\s*(?:minutes|minute|mins|min|m)\b/);
  if (hm && mm) return Math.round(Number(hm[1]) * 60 + Number(mm[1]));
  if (hm) return Math.round(Number(hm[1]) * 60);
  if (mm) return Number(mm[1]);
  const forTime = text.match(/\bfor\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (forTime && !/am|pm/.test(forTime[0])) {
    return Number(forTime[1]) * 60 + Number(forTime[2] || 0);
  }
  if (/\bquick\b|\bquick one\b/.test(text)) return 30;
  if (/\ball day\b/.test(text)) return 480;
  return undefined;
}

function parseKind(text: string): EventKind | undefined {
  if (/\b(social|friends|friend|hang|date|party|dinner|brunch|drinks|catch up|catch-up)\b/.test(text))
    return "social";
  if (/\b(gym|run|yoga|walk|doctor|health|therapy|sleep)\b/.test(text)) return "health";
  if (/\b(work|meeting|standup|stand-up|sync|deadline|sprint|deep work|focus|client|boss|office|zoom|call with)\b/.test(text))
    return "work";
  if (/\b(personal|errand|family|laundry|grocery|groceries)\b/.test(text)) return "personal";
  return undefined;
}

function parsePriority(text: string): TodoPriority | undefined {
  if (/\b(p0|urgent|asap|critical|drop everything)\b/.test(text)) return "p0";
  if (/\b(p1|high|important|need this)\b/.test(text)) return "p1";
  if (/\b(p2|medium|normal)\b/.test(text)) return "p2";
  if (/\b(p3|low|whenever|someday|meh)\b/.test(text)) return "p3";
  return undefined;
}

function parsePrefs(text: string, notes: string[]) {
  const prefs: ParsedMessage["prefs"] = {};
  const social = text.match(
    /\b(?:want|need|protect|keep|give me|i want)?\s*(?:at least\s*)?(\d+(?:\.\d+)?)\s*(?:hours|hour)\s*(?:of\s+)?(?:social|friends|hangout|life)/,
  );
  const social2 = text.match(
    /\b(\d+(?:\.\d+)?)\s*(?:hours|hour)\s*(?:of\s+)?social/,
  );
  if (social || social2) {
    const n = Number((social || social2)![1]);
    prefs.socialMinutesPerDay = Math.round(n * 60);
    notes.push(`social goal → ${n}h`);
  }
  const socialMin = text.match(/\b(\d+)\s*minutes?\s*(?:of\s+)?social/);
  if (socialMin) {
    prefs.socialMinutesPerDay = Number(socialMin[1]);
    notes.push(`social goal → ${socialMin[1]}m`);
  }
  const maxWork = text.match(
    /\b(?:max|no more than|cap|limit)\s*(\d+(?:\.\d+)?)\s*(?:hours|hour)\s*(?:of\s+)?work/,
  );
  if (maxWork) {
    prefs.maxWorkMinutesPerDay = Math.round(Number(maxWork[1]) * 60);
    notes.push(`work cap → ${maxWork[1]}h`);
  }
  const workRange = text.match(
    /\b(?:work|working|i work)\s*(?:from\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/,
  );
  if (workRange) {
    const toHm = (
      h0: string,
      m0: string | undefined,
      ap: string | undefined,
      fallbackAp?: string,
    ) => {
      let h = Number(h0);
      const m = Number(m0 || 0);
      const mer = ap || fallbackAp;
      if (mer === "pm" && h < 12) h += 12;
      if (mer === "am" && h === 12) h = 0;
      if (!mer && h < 8) h += 12;
      return minutesToHM(h * 60 + m);
    };
    prefs.workStart = toHm(workRange[1], workRange[2], workRange[3], workRange[6]);
    prefs.workEnd = toHm(workRange[4], workRange[5], workRange[6], workRange[3]);
    notes.push(`work window ${prefs.workStart}–${prefs.workEnd}`);
  }
  const wake = text.match(/\b(?:wake|up|wakeup)\s*(?:up\s*)?(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (wake && /\bwake\b/.test(text)) {
    let h = Number(wake[1]);
    const m = Number(wake[2] || 0);
    if (wake[3] === "pm" && h < 12) h += 12;
    prefs.wakeTime = minutesToHM(h * 60 + m);
    notes.push(`wake ${prefs.wakeTime}`);
  }
  const sleep = text.match(/\b(?:sleep|bed|knock out)\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (sleep && /\b(sleep|bed|knock out)\b/.test(text)) {
    let h = Number(sleep[1]);
    const m = Number(sleep[2] || 0);
    const ap = sleep[3];
    if (!ap && h <= 11) h += 12;
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    prefs.sleepTime = minutesToHM(h * 60 + m);
    notes.push(`sleep ${prefs.sleepTime}`);
  }
  if (/\bno work after\b|\bprotect my evenings\b|\bno meetings after\b/.test(text)) {
    const t = parseTime(text);
    if (t.start) prefs.noWorkAfter = t.start;
    else prefs.noWorkAfter = "19:00";
    if (t.start) prefs.protectEveningsAfter = t.start;
    notes.push(`no work after ${prefs.noWorkAfter}`);
  }
  return prefs;
}

function stripTitle(text: string): string {
  return text
    .replace(/\b(please|can you|could you|wanna|i want to|i need to|remind me to|add|schedule|plan|book|put|set)\b/g, " ")
    .replace(/\b(today|tomorrow|tonight|this (?:morning|afternoon|evening|weekend)|next week)\b/g, " ")
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/g, " ")
    .replace(/\b(at\s+)?\d{1,2}(?::\d{2})?\s*(am|pm)?\b/g, " ")
    .replace(/\bfor\s+\d+(?:\.\d+)?\s*(hours|hour|minutes|minute|hrs|hr|h|m)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(hours|hour|minutes|minute|hrs|hr|h|m)\b/g, " ")
    .replace(/\b(p0|p1|p2|p3|urgent|high priority|low priority)\b/g, " ")
    .replace(/\b(work|social|personal|health)\b/g, " ")
    .replace(/\b(meeting|call|event|todo|task|reminder)\b/g, " ")
    .replace(/[?.!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isConfirm(text: string): boolean {
  return /^(yes|y|ok|okay|sure|do it|lock it|lock|go ahead|sounds good|perfect|bet|i guess|alright|all good|yup|confirm|save it|make the change|apply it)$/.test(
    text,
  ) || /\b(lock it in|make it so|go for it|make the change|yes change it|apply the change)\b/.test(text);
}

function isCancel(text: string): boolean {
  return (
    /^(no|nope|nah|never mind|nevermind|cancel|stop|forget it|don't|dont|wait|leave it)$/.test(text) ||
    /\b(nah,? cancel|no,? cancel|cancel (it|that)|scrap (it|that)|never mind|leave it)\b/.test(text)
  );
}

export function parseBulletItems(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const strip = (l: string) =>
    l
      .replace(/^[-*•–—▪◦]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/^\[(?: |x|X)\]\s+/, "")
      .trim();
  const marked = lines.filter((l) => /^([-*•–—▪◦]|\d+[.)]|\[(?: |x|X)\])\s+\S/.test(l));
  if (marked.length >= 2 || (marked.length === 1 && lines.length === 1)) {
    return marked.map(strip).filter((t) => t.length > 1);
  }
  if (lines.length >= 2 && marked.length === lines.length) {
    return lines.map(strip).filter((t) => t.length > 1);
  }
  return [];
}

function isOptionsAsk(text: string): boolean {
  return (
    /\b(what else can i do|what else can you do|what can i do|give (me )?(the )?options|see (the )?options|show (me )?(the )?options|more options|the options|see options)\b/.test(
      text,
    ) || /^(options|option|menu|what else)$/.test(text)
  );
}

function isCalendarConnected(text: string): boolean {
  return /\bconnected (my )?(google |apple |outlook |copy |snapshot )?(calendar)\b/.test(text);
}

export function parseMessage(raw: string, user: UserRecord): ParsedMessage {
  const notes: string[] = [];
  const normalized = normalize(raw);
  const tz = user.settings.timezone || "UTC";
  const prefs = parsePrefs(normalized, notes);
  const { date, note: dateNote } = parseDate(normalized, tz);
  const { start, note: timeNote } = parseTime(normalized);
  const durationMinutes = parseDuration(normalized);
  const kind = parseKind(normalized);
  const priority = parsePriority(normalized);
  if (dateNote) notes.push(dateNote);
  if (timeNote) notes.push(timeNote);

  let intent: Intent = "unknown";
  const confirm = isConfirm(normalized);
  const cancel = isCancel(normalized);
  const listItems = parseBulletItems(raw);

  if (isOptionsAsk(normalized)) intent = "options";
  else if (isCalendarConnected(normalized)) intent = "calendar_connected";
  else if (confirm) intent = "confirm";
  else if (cancel) intent = "cancel";
  else if (
    Object.keys(prefs).length &&
    /\b(want|need|set|make|keep|protect|from|wake|sleep|cap|limit|hours of social|social hours|work from)\b/.test(
      normalized,
    )
  ) {
    intent = "set_pref";
  } else if (
    /\b(what's today|whats today|rundown|run down|my day|schedule|what's on|whats on|today look|plan for today|show (my )?day)\b/.test(
      normalized,
    )
  ) {
    intent = "schedule";
  } else if (/\boverlap/.test(normalized) || /\bdouble.?book/.test(normalized)) {
    intent = "overlaps";
  } else if (
    /\b(my todos|to-?dos|tasks|hierarchy|what do i have to do|open tasks)\b/.test(normalized)
  ) {
    intent = "todos";
  } else if (
    /\b(done with|finished|mark (as )?done|complete|checked off|tick off)\b/.test(normalized)
  ) {
    intent = "complete_todo";
  } else if (listItems.length >= 2 || (listItems.length === 1 && /^[-*•–—]/.test(raw.trim()))) {
    intent = "add_todo";
  } else if (
    /\b(remind me|todo|to-do|task|need to|gotta|got to|have to|don't forget|dont forget|add under)\b/.test(
      normalized,
    ) &&
    !/\b(meeting|call|dinner|lunch|appointment|gym at|interview)\b/.test(normalized)
  ) {
    intent = "add_todo";
  } else if (
    /\b(meeting|call|lunch|dinner|brunch|gym|interview|appointment|hang|date|block|deep work|sync|plan|schedule|book|put me down)\b/.test(
      normalized,
    ) ||
    (start && /\b(at|from|tomorrow|today|tonight|monday|friday)\b/.test(normalized))
  ) {
    intent = "add_event";
  } else if (/^(hi|hey|hello|yo|sup|what's up|whats up|heya)$/.test(normalized)) {
    intent = "greet";
  } else if (/\b(help|what can you|how do i|commands)\b/.test(normalized)) {
    intent = "help";
  } else if (
    /\b(add to calendar|google calendar|apple calendar|android calendar|outlook calendar|connect calendar|subscribe calendar|sync calendar|put it on my calendar|export to calendar)\b/.test(
      normalized,
    )
  ) {
    intent = "calendar";
  } else if (/\b(how am i doing|buffer|burnout|overworked)\b/.test(normalized)) {
    intent = "status";
  } else if (
    /\b(thanks|thank you|lol|haha|ok cool|cool|nice|love you)\b/.test(normalized)
  ) {
    intent = "chitchat";
  }

  if (intent === "unknown" && user.draft.type === "event") intent = "add_event";
  if (intent === "unknown" && user.draft.type === "todo") intent = "add_todo";

  let title = stripTitle(normalized);
  if (title.length < 2) {
    if (/\blunch\b/.test(normalized)) title = "Lunch";
    else if (/\bdinner\b/.test(normalized)) title = "Dinner";
    else if (/\bgym\b/.test(normalized)) title = "Gym";
    else if (/\bmeeting\b/.test(normalized)) title = "Meeting";
    else if (/\bcall\b/.test(normalized)) title = "Call";
    else title = raw.trim();
  }
  title = title.replace(/^(to|for|with)\s+/i, "");
  title = title.replace(/\bunder\s+[^:]+:\s*/i, "");
  title = title.replace(/\b\d+(?:\.\d+)?\s*(?:hours|hour|minutes|minute|hrs|hr|mins|min|h|m)\b/gi, "");
  title = title.replace(/\s+/g, " ").trim();
  title = title.replace(/(\b(for|to|with|at|on)\s*)+$/i, "").trim();
  title = title.replace(/^[,.\s]+|[,.\s]+$/g, "").trim();
  if (title.length < 2) {
    if (/\bgym\b/.test(normalized)) title = "Gym";
    else if (/\bmeeting\b/.test(normalized)) title = "Meeting";
    else title = raw.split("\n")[0].trim() || "Event";
  }
  title = title.charAt(0).toUpperCase() + title.slice(1);

  const renameTo = (normalized.match(/\b(?:rename|change)\s+.+?\s+to\s+(.+)$/) ||
    normalized.match(/\bcall (?:it|that)\s+(.+)$/))?.[1]?.trim();
  const targetHint = hintFromText(raw) || title;
  const lockedIntents = new Set([
    "options",
    "calendar_connected",
    "confirm",
    "cancel",
    "set_pref",
    "schedule",
    "help",
    "calendar",
    "complete_todo",
    "overlaps",
    "greet",
  ]);
  if (/\b(reshuffle|move (around )?my tasks|shuffle (my )?tasks|move around tasks|move tasks around|reshuffle around this event)\b/.test(
    normalized,
  )) {
    intent = "reshuffle";
  } else if (/\b(unstar|unpin|unfavourite|unfavorite)\b/.test(normalized)) {
    intent = "unstar";
  } else if (/\bstar\b/.test(normalized) || /\b(favourite|favorite|prioritize|pin this)\b/.test(normalized)) {
    intent = "star";
  } else if (!lockedIntents.has(intent) && user.draft.type !== "event") {
    const hit = findNamedItem(user, targetHint) || findNamedItem(user, title);
    const changeVerb =
      Boolean(renameTo) ||
      /\b(change|move|rename|update|reschedule|shift|push|delay|switch)\b/.test(normalized);
    const slotChange = Boolean(date || start || durationMinutes || kind);
    if (
      hit &&
      (changeVerb || slotChange) &&
      !/\b(another|brand new|also add|plan an event)\b/.test(normalized)
    ) {
      intent = "edit_item";
    }
  }

  const parent = normalized.match(/\bunder\s+(.+?)(?::|,| add | - |$)/);
  const doneHint = normalized
    .replace(/\b(done with|finished|mark (as )?done|complete|checked off|tick off)\b/g, "")
    .trim();

  const parsed: ParsedMessage = {
    intent,
    normalized,
    event: {
      title,
      date,
      start,
      durationMinutes,
      kind,
      timeUnknown: !start,
    },
    todo: {
      title,
      priority,
      estimatedMinutes: durationMinutes,
      parentHint: parent?.[1]?.trim(),
      kind: kind || "work",
      dueDate: date,
      doneHint,
      items: listItems.length ? listItems : undefined,
    },
    prefs,
    confirm,
    cancel,
    renameTo,
    targetHint,
    notes,
    debug: {
      at: new Date().toISOString(),
      raw,
      normalized,
      intent,
      slots: {
        date,
        start,
        durationMinutes,
        kind,
        priority,
        title,
        socialMinutesPerDay: prefs.socialMinutesPerDay,
      },
      notes,
    },
  };
  void hmToMinutes;
  return parsed;
}
