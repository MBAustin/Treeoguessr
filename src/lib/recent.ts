// Remembers recently-seen species across games (in localStorage) so the solo
// game doesn't keep serving the same common plants. Bounded FIFO of taxon ids.

const KEY = "treeoguessr:recentTaxa";
const MAX = 80;

export function getRecentTaxa(): number[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

/** Record taxa just seen, newest first, keeping at most MAX. */
export function pushRecentTaxa(ids: number[]): void {
  if (typeof localStorage === "undefined" || ids.length === 0) return;
  const current = getRecentTaxa().filter((id) => !ids.includes(id));
  const merged = [...ids, ...current].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* storage full / disabled — best effort */
  }
}
