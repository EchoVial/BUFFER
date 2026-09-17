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
  action?: "reply" | "google-cal" | "ics" | "connect-feed" | "outlook-cal";
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
}

export type MessageCard =
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
  calendarToken?: string;
  calendarConnectedAt?: string;
  calendarConnectedVia?: string;
  lastNlp?: NlpDebug;
  notes?: string;
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
  socialMinutesPerDay: 120,
  maxWorkMinutesPerDay: 480,
  reminderLeadMinutes: 15,
  protectEveningsAfter: "19:00",
  timezone: "UTC",
  weekendSocialBonusMinutes: 60,
  noWorkAfter: "20:00",
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  botDisplayName: "Buffer",
  botAbout:
    "Your work-life wingman. Plans events, stacks to-dos, flags overlaps, and protects social time.",
  defaultUserSettings: DEFAULT_USER_SETTINGS,
  debugNlpInChat: false,
  allowAutoCreateUsers: true,
};
