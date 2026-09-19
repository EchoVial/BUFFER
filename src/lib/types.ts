export type EventKind = "work" | "social" | "personal" | "health" | "other";
export type TodoPriority = "p0" | "p1" | "p2" | "p3";
export type MessageStatus = "sent" | "delivered" | "read";
export type MessageRole = "user" | "bot" | "system";
export type DraftType = "event" | "todo" | "none" | "edit" | "reshuffle";

export interface UserSettings {
  wakeTime: string;
  sleepTime: string;
  workStart: string;
  workEnd: string;
  socialMinutesPerDay: number;
  maxWorkMinutesPerDay: number;
  reminderLeadMinutes: number;
  protectEveningsAfter: string;
  timezone: string;
  weekendSocialBonusMinutes: number;
  noWorkAfter: string | null;
  /** What the standing weekday block is called on the day picture: "Work", "Class", "Shift". */
  workLabel?: string;
  /** Which days the standing hours fall on, 0 = Sunday .. 6 = Saturday. Unset means Monday to Friday. */
  workDays?: number[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  kind: EventKind;
  date: string;
  start: string;
  durationMinutes: number;
  notes?: string;
  flexible: boolean;
  starred?: boolean;
  /** "Reserved for you": kept clear of work on purpose, and the first place Buffer suggests people time. */
  reserved?: boolean;
  createdAt: string;
}

export interface TodoItem {
  id: string;
  title: string;
  notes?: string;
  priority: TodoPriority;
  parentId: string | null;
  estimatedMinutes: number;
  dueDate?: string;
  done: boolean;
  kind: EventKind;
  starred?: boolean;
  plannedStart?: string;
  plannedDate?: string;
  createdAt: string;
}

export interface ReplyButton {
  id: string;
  title: string;
  payload?: string;
  action?: "reply" | "google-cal" | "ics" | "connect-feed" | "outlook-cal" | "notify";
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
  payload: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export interface InteractiveList {
  button: string;
  footer?: string;
  sections: ListSection[];
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  createdAt: string;
  status: MessageStatus;
  card?: MessageCard;
  replyToId?: string;
  buttons?: ReplyButton[];
  list?: InteractiveList;
  calendarEventId?: string;
  /** Bot messages Buffer sent on its own: the 8 am picture, the evening nudge, an event reminder. */
  tag?: "digest" | "nudge" | "reminder";
  /** User messages: what Buffer made of it ("add_event", "set_pref", "week"...), or "fast" for a button or a one-word command. */
  intent?: string;
  channel?: "whatsapp" | "web";
}

/** A picture instead of a wall of text: the week as bars, or a day as a strip. Drawn client-side. */
export type ImageCard =
  | {
      type: "image";
      variant: "week";
      title: string;
      subtitle: string;
      /** For today, freeMinutes and workMinutes are what is still ahead; goneMinutes is the part of the day already behind you. */
      days: Array<{ date: string; label: string; freeMinutes: number; workMinutes: number; peopleMinutes?: number; goneMinutes?: number; best?: string; today?: boolean }>;
    }
  | {
      type: "image";
      variant: "day";
      title: string;
      subtitle: string;
      date: string;
      fromMin: number;
      toMin: number;
      nowMin?: number;
      blocks: Array<{ title: string; kind: string; startMin: number; endMin: number; id?: string; movable?: boolean }>;
      footer: string;
      /** Title of a block to outline as "new" (proposals). */
      highlight?: string;
    };

export type MessageCard =
  | ImageCard
  | {
      type: "schedule";
      date: string;
      lines: string[];
      warnings: string[];
      stats: DayStats;
    }
  | {
      type: "proposal";
      date: string;
      summary: string;
      before: string[];
      after: string[];
      moves: string[];
      warnings: string[];
      eventPreview: string;
    }
  | {
      type: "todos";
      lines: string[];
    }
  | {
      type: "overlaps";
      items: string[];
    }
  | {
      type: "debug";
      json: string;
    };

export interface DayStats {
  workMinutes: number;
  socialMinutes: number;
  personalMinutes: number;
  freeMinutes: number;
  socialTarget: number;
  workCap: number;
}

export interface EditProposal {
  kind: "event" | "todo";
  id: string;
  title: string;
  summary: string;
  eventPatch?: Partial<CalendarEvent>;
  todoPatch?: Partial<TodoItem>;
  remove?: boolean;
}

export interface ReshuffleProposal {
  eventId: string;
  todos: Array<{ id: string; plannedDate: string; plannedStart: string }>;
  summary: string;
}

export interface ConversationDraft {
  type: DraftType;
  event?: Partial<CalendarEvent> & { raw?: string };
  todo?: Partial<TodoItem> & { raw?: string };
  missing: string[];
  proposal?: Extract<MessageCard, { type: "proposal" }>;
  edit?: EditProposal;
  reshuffle?: ReshuffleProposal;
}

export interface UserRecord {
  id: string;
  name: string;
  nameKey: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  settings: UserSettings;
  events: CalendarEvent[];
  todos: TodoItem[];
  messages: ChatMessage[];
  draft: ConversationDraft;
  remindedEventIds: string[];
  lastLockedEventId?: string;
  /** What "clear my day" removed, so *undo* can put it back. */
  lastCleared?: { date: string; events: CalendarEvent[]; dayOff: boolean };
  calendarToken?: string;
  calendarConnectedAt?: string;
  calendarConnectedVia?: string;
  lastNlp?: NlpDebug;
  notes?: string;
  /** Date (YYYY-MM-DD, user tz) of the last morning digest, so it goes out once a day. */
  lastDigestDate?: string;
  /** First-run questions: work hours, unwind time, who to call, calendar, nudges allowed. Missing = done (older users). */
  onboarding?: "work" | "unwind" | "people" | "calendar" | "notify" | "done";
  /** They said "no morning picture": skip the 8 am snapshot of the day. */
  morningOff?: boolean;
  /** Google Calendar, connected through OAuth; every saved event is mirrored there. */
  google?: { refreshToken: string; email?: string; connectedAt: string };
  /** Our event id -> the Google event it became, with a fingerprint to spot edits. */
  googleSynced?: Record<string, { gid: string; hash: string }>;
  /** They allowed browser notifications for the evening nudge. */
  notify?: boolean;
  /** People Buffer nudges them to call when they are free (from onboarding or chat). */
  people?: string[];
  /** Lowercase name -> last day (YYYY-MM-DD) they were in touch, from "called mum" and the like. Saved social plans count too. */
  lastContact?: Record<string, string>;
  /** Lowercase name -> WhatsApp digits, from a shared contact card or "mum's number is ...", so a nudge can open the chat. */
  peopleNumbers?: Record<string, string>;
  /** One-line explanations already shown, so each feature is explained once. */
  tips?: string[];
  /** Date of the last "you're off the clock, call someone" nudge. */
  lastNudgeDate?: string;
  /** Rotates through `people` so the nudges do not always name the same person. */
  nudgeIndex?: number;
  /** Dates (YYYY-MM-DD) with no standing work/class block: "no class tomorrow", "off friday". */
  daysOff?: string[];
  /** WhatsApp: the phone that talks to the bot (digits, country code first), and the last message ids answered. */
  waPhone?: string;
  waSeen?: string[];
}

export interface NlpDebug {
  at: string;
  raw: string;
  normalized: string;
  intent: string;
  slots: Record<string, string | number | boolean | undefined>;
  notes: string[];
}

export interface AppSettings {
  botDisplayName: string;
  botAbout: string;
  defaultUserSettings: UserSettings;
  debugNlpInChat: boolean;
  allowAutoCreateUsers: boolean;
}

export interface AppStore {
  settings: AppSettings;
  users: Record<string, UserRecord>;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  wakeTime: "07:00",
  sleepTime: "23:00",
  workStart: "09:00",
  workEnd: "18:00",
  socialMinutesPerDay: 0,
  maxWorkMinutesPerDay: 480,
  reminderLeadMinutes: 15,
  protectEveningsAfter: "19:00",
  timezone: "UTC",
  weekendSocialBonusMinutes: 0,
  noWorkAfter: "20:00",
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  botDisplayName: "Buffer",
  botAbout:
    "Tell Buffer when you work. It shows you when you are actually free, and nudges you to spend some of that time with the people you love.",
  defaultUserSettings: DEFAULT_USER_SETTINGS,
  debugNlpInChat: false,
  allowAutoCreateUsers: true,
};
