const WATCHLIST_STORAGE_KEY = 'auction_watchlist_v1';

type WatchlistMap = Record<string, number[]>;

function readStore(): WatchlistMap {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as WatchlistMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: WatchlistMap): void {
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(store));
}

export function getWatchlist(userKey: string): number[] {
  const store = readStore();
  return Array.isArray(store[userKey]) ? store[userKey] : [];
}

export function isInWatchlist(userKey: string, listingId: number): boolean {
  return getWatchlist(userKey).includes(listingId);
}

export function toggleWatchlist(userKey: string, listingId: number): boolean {
  const store = readStore();
  const current = Array.isArray(store[userKey]) ? store[userKey] : [];
  const next = current.includes(listingId)
    ? current.filter((id) => id !== listingId)
    : [...current, listingId];

  store[userKey] = next;
  writeStore(store);
  return next.includes(listingId);
}
