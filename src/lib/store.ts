import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AppStore,
  DEFAULT_APP_SETTINGS,
  DEFAULT_USER_SETTINGS,
  UserRecord,
  UserSettings,
} from "./types";
import { nameKey, uid } from "./ids";

const STORE_PATH = join(process.cwd(), "data", "store.json");
const KV_KEY = "balance-store";

type GlobalWithStore = typeof globalThis & {
  __balanceStore?: AppStore;
  __balanceStoreLoad?: Promise<AppStore>;
};

function emptyStore(): AppStore {
  return {
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    users: {},
  };
}

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export function persistBackend(): string {
  if (kvCreds()) return "kv";
  if (process.env.VERCEL) return "memory";
  return "file";
}

async function kvCommand(command: unknown[]): Promise<unknown> {
  const creds = kvCreds();
  if (!creds) return null;
  const res = await fetch(creds.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as { result?: unknown };
  return payload.result ?? null;
}

async function kvGet(): Promise<AppStore | null> {
  try {
    const raw = await kvCommand(["GET", KV_KEY]);
    if (typeof raw !== "string" || !raw) return null;
    return JSON.parse(raw) as AppStore;
  } catch {
    return null;
  }
}

async function kvSet(store: AppStore) {
  try {
    await kvCommand(["SET", KV_KEY, JSON.stringify(store)]);
  } catch {
    /* ignore */
  }
}

function loadFromDisk(): AppStore | null {
  try {
    const raw = readFileSync(STORE_PATH, "utf8");
    return JSON.parse(raw) as AppStore;
  } catch {
    return null;
  }
}

function writeLocal(store: AppStore) {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch {
    try {
      writeFileSync("/tmp/balance-store.json", JSON.stringify(store), "utf8");
    } catch {
      /* ignore */
    }
  }
}

function migrateStore(store: AppStore): AppStore {
  if (store.settings.botDisplayName === "Balance") {
    store.settings.botDisplayName = DEFAULT_APP_SETTINGS.botDisplayName;
  }
  if (
    !store.settings.botAbout ||
    /work-life wingman|protects social time/i.test(store.settings.botAbout)
  ) {
    store.settings.botAbout = DEFAULT_APP_SETTINGS.botAbout;
  }
  return store;
}

async function hydrate(): Promise<AppStore> {
  const fromKv = await kvGet();
  if (fromKv) return migrateStore(fromKv);
  const disk = loadFromDisk();
  if (disk) return migrateStore(disk);
  try {
    const tmp = readFileSync("/tmp/balance-store.json", "utf8");
    return migrateStore(JSON.parse(tmp) as AppStore);
  } catch {
    return emptyStore();
  }
}

export async function getStore(): Promise<AppStore> {
  const g = globalThis as GlobalWithStore;
  if (g.__balanceStore) return migrateStore(g.__balanceStore);
  if (!g.__balanceStoreLoad) {
    g.__balanceStoreLoad = hydrate().then((store) => {
      g.__balanceStore = store;
      return store;
    });
  }
  return g.__balanceStoreLoad;
}

/** Re-read the shared store so a warm instance does not act on a stale copy (other instances write too). */
export async function refreshStore(): Promise<AppStore> {
  const g = globalThis as GlobalWithStore;
  const fromKv = await kvGet();
  if (fromKv) g.__balanceStore = migrateStore(fromKv);
  return getStore();
}

const localLocks = new Map<string, Promise<void>>();

/**
 * Run `fn` while holding a lock on `key` (a phone number): two webhook calls
 * for the same person then take turns instead of both creating them or
 * overwriting each other's save. Redis SET NX when we have it, a promise chain
 * in this process otherwise. The lock expires on its own if a run dies.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>, waitMs = 40_000): Promise<T> {
  if (!kvCreds()) {
    const prev = localLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    localLocks.set(key, prev.then(() => mine));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (localLocks.get(key) === mine) localLocks.delete(key);
    }
  }
  const lockKey = `${KV_KEY}:lock:${key}`;
  const deadline = Date.now() + waitMs;
  while ((await kvCommand(["SET", lockKey, "1", "NX", "PX", 45_000])) !== "OK") {
    if (Date.now() > deadline) break; // rather answer late than never
    await new Promise((r) => setTimeout(r, 400));
  }
  try {
    return await fn();
  } finally {
    await kvCommand(["DEL", lockKey]);
  }
}

export async function saveStore(store: AppStore) {
  const g = globalThis as GlobalWithStore;
  g.__balanceStore = store;
  writeLocal(store);
  await kvSet(store);
}

export async function listUsers(): Promise<UserRecord[]> {
  return Object.values((await getStore()).users).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export async function getUserById(id: string): Promise<UserRecord | undefined> {
  return Object.values((await getStore()).users).find((u) => u.id === id);
}

export async function getUserByCalendarToken(
  token: string,
): Promise<UserRecord | undefined> {
  if (!token) return undefined;
  return Object.values((await getStore()).users).find((u) => u.calendarToken === token);
}

export async function getUserByPhone(phone: string): Promise<UserRecord | undefined> {
  const digits = phone.replace(/\D/g, "");
  return Object.values((await getStore()).users).find((u) => u.waPhone === digits);
}

/** A WhatsApp person: keyed by phone, so two people called Ved do not collide. */
export async function createWhatsAppUser(phone: string, name: string, timezone: string): Promise<UserRecord> {
  const digits = phone.replace(/\D/g, "");
  const existing = await getUserByPhone(digits);
  if (existing) return existing;
  const store = await getStore();
  const now = new Date().toISOString();
  const user: UserRecord = {
    id: uid("user"),
    name: name.trim() || "there",
    nameKey: `wa:${digits}`,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    settings: { ...store.settings.defaultUserSettings, ...DEFAULT_USER_SETTINGS, timezone },
    events: [],
    todos: [],
    messages: [],
    draft: { type: "none", missing: [] },
    remindedEventIds: [],
    waPhone: digits,
    waSeen: [],
  };
  return upsertUser(user);
}

export async function getUserByName(name: string): Promise<UserRecord | undefined> {
  const key = nameKey(name);
  const store = await getStore();
  return Object.values(store.users).find((u) => u.nameKey === key);
}

export async function upsertUser(user: UserRecord): Promise<UserRecord> {
  const store = await getStore();
  const next = {
    ...user,
    calendarToken: user.calendarToken || uid("cal"),
    updatedAt: new Date().toISOString(),
  };
  store.users[user.id] = next;
  await saveStore(store);
  return store.users[user.id];
}

export async function deleteUser(id: string): Promise<boolean> {
  const store = await getStore();
  if (!store.users[id]) return false;
  delete store.users[id];
  await saveStore(store);
  return true;
}

export async function createUser(
  name: string,
  extras?: { notes?: string; settings?: Partial<UserSettings> },
): Promise<UserRecord> {
  const existing = await getUserByName(name);
  if (existing) return existing;
  const store = await getStore();
  const now = new Date().toISOString();
  const user: UserRecord = {
    id: uid("user"),
    name: name.trim(),
    nameKey: nameKey(name),
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    settings: {
      ...store.settings.defaultUserSettings,
      ...DEFAULT_USER_SETTINGS,
      ...extras?.settings,
    },
    events: [],
    todos: [],
    messages: [],
    draft: { type: "none", missing: [] },
    remindedEventIds: [],
    notes: extras?.notes,
  };
  return upsertUser(user);
}

export async function getAppSettings() {
  return (await getStore()).settings;
}

export async function patchAppSettings(patch: Partial<AppStore["settings"]>) {
  const store = await getStore();
  store.settings = { ...store.settings, ...patch };
  if (patch.defaultUserSettings) {
    store.settings.defaultUserSettings = {
      ...store.settings.defaultUserSettings,
      ...patch.defaultUserSettings,
    };
  }
  await saveStore(store);
  return store.settings;
}

export async function mergeIncomingUser(incoming: UserRecord): Promise<UserRecord> {
  const current = (await getUserById(incoming.id)) ?? (await getUserByName(incoming.name));
  if (!current) return upsertUser(incoming);
  const newer =
    new Date(incoming.updatedAt).getTime() >=
    new Date(current.updatedAt).getTime()
      ? incoming
      : current;
  return upsertUser({
    ...newer,
    lastSeenAt: new Date().toISOString(),
  });
}
