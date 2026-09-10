import { defaultRooms, emptyState, ensureMediaCatalog, normalizeItem, normalizeRoom, normalizeSettings, type AppState } from "./types";

const KEY = "coastal-supply:v1";

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.version !== 1 || !parsed.settings || !Array.isArray(parsed.items)) {
      return emptyState();
    }
    return {
      version: 1,
      settings: normalizeSettings(parsed.settings),
      items: (parsed.items ?? []).map((item) => normalizeItem(item)),
      events: parsed.events ?? [],
      orders: parsed.orders ?? [],
      rooms: Array.isArray((parsed as AppState).rooms)
        ? (parsed as AppState).rooms.map((room) => normalizeRoom(room))
        : defaultRooms(),
    };
  } catch {
    return emptyState();
  }
}

export function saveState(state: AppState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function exportBackup(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importBackup(raw: string): AppState {
  const parsed = JSON.parse(raw) as AppState;
  if (parsed.version !== 1) throw new Error("This backup file is not recognized.");
  return {
    version: 1,
    settings: normalizeSettings(parsed.settings),
    items: ensureMediaCatalog((parsed.items ?? []).map((item) => normalizeItem(item))).items,
    events: parsed.events ?? [],
    orders: parsed.orders ?? [],
    rooms: Array.isArray(parsed.rooms) ? parsed.rooms.map((room) => normalizeRoom(room)) : defaultRooms(),
  };
}
