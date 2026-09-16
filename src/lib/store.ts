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

async function hydrate(): Promise<AppStore> {
  const fromKv = await kvGet();
  if (fromKv) return fromKv;
  const disk = loadFromDisk();
  if (disk) return disk;
  try {
    const tmp = readFileSync("/tmp/balance-store.json", "utf8");
    return JSON.parse(tmp) as AppStore;
  } catch {
    return emptyStore();
  }
}

export async function getStore(): Promise<AppStore> {
  const g = globalThis as GlobalWithStore;
  if (g.__balanceStore) return g.__balanceStore;
  if (!g.__balanceStoreLoad) {
    g.__balanceStoreLoad = hydrate().then((store) => {
      g.__balanceStore = store;
      return store;
    });
  }
  return g.__balanceStoreLoad;
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
