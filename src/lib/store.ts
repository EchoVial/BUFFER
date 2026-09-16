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

type GlobalWithStore = typeof globalThis & {
  __balanceStore?: AppStore;
};

function emptyStore(): AppStore {
  return {
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    users: {},
  };
}

function loadFromDisk(): AppStore | null {
  try {
    const raw = readFileSync(STORE_PATH, "utf8");
    return JSON.parse(raw) as AppStore;
  } catch {
    return null;
  }
}

function persist(store: AppStore) {
  const g = globalThis as GlobalWithStore;
  g.__balanceStore = store;
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // Vercel serverless filesystem is read-only except /tmp; in-memory still works.
    try {
      writeFileSync("/tmp/balance-store.json", JSON.stringify(store), "utf8");
    } catch {
      /* ignore */
    }
  }
}

export function getStore(): AppStore {
  const g = globalThis as GlobalWithStore;
  if (g.__balanceStore) return g.__balanceStore;
  const disk = loadFromDisk();
  if (disk) {
    g.__balanceStore = disk;
    return disk;
  }
  try {
    const tmp = readFileSync("/tmp/balance-store.json", "utf8");
    const parsed = JSON.parse(tmp) as AppStore;
    g.__balanceStore = parsed;
    return parsed;
  } catch {
    const fresh = emptyStore();
    persist(fresh);
    return fresh;
  }
}

export function saveStore(store: AppStore) {
  persist(store);
}

export function listUsers(): UserRecord[] {
  return Object.values(getStore().users).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function getUserById(id: string): UserRecord | undefined {
  return Object.values(getStore().users).find((u) => u.id === id);
}

export function getUserByName(name: string): UserRecord | undefined {
  const key = nameKey(name);
  const store = getStore();
  return Object.values(store.users).find((u) => u.nameKey === key);
}

export function upsertUser(user: UserRecord): UserRecord {
  const store = getStore();
  store.users[user.id] = { ...user, updatedAt: new Date().toISOString() };
  saveStore(store);
  return store.users[user.id];
}

export function deleteUser(id: string): boolean {
  const store = getStore();
  if (!store.users[id]) return false;
  delete store.users[id];
  saveStore(store);
  return true;
}

export function createUser(
  name: string,
  extras?: { notes?: string; settings?: Partial<UserSettings> },
): UserRecord {
  const existing = getUserByName(name);
  if (existing) return existing;
  const store = getStore();
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

export function getAppSettings() {
  return getStore().settings;
}

export function patchAppSettings(patch: Partial<AppStore["settings"]>) {
  const store = getStore();
  store.settings = { ...store.settings, ...patch };
  if (patch.defaultUserSettings) {
    store.settings.defaultUserSettings = {
      ...store.settings.defaultUserSettings,
      ...patch.defaultUserSettings,
    };
  }
  saveStore(store);
  return store.settings;
}

export function mergeIncomingUser(incoming: UserRecord): UserRecord {
  const current = getUserById(incoming.id) ?? getUserByName(incoming.name);
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
