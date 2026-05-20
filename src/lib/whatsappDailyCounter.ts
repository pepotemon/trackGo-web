export const WA_DAILY_LIMIT = 15;

const STORAGE_KEY = "wa_daily_count";

type CountStore = { date: string; count: number };

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function canUseStorage() {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStore(): CountStore {
    if (!canUseStorage()) return { date: todayKey(), count: 0 };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const s = JSON.parse(raw) as CountStore;
            if (s.date === todayKey()) return s;
        }
    } catch {}
    return { date: todayKey(), count: 0 };
}

function writeStore(store: CountStore) {
    if (!canUseStorage()) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {}
}

export function getWaDailyCount(): number {
    return readStore().count;
}

export function incrementWaDailyCount(): number {
    const store = readStore();
    store.count++;
    writeStore(store);
    return store.count;
}
