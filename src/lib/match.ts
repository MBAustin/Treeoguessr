// Tolerant matching of a player's typed plant name against the accepted name(s).
// Handles case, accents, punctuation, spacing, and small typos.

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip diacritics (combining marks)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function closeEnough(input: string, target: string): boolean {
  const a = normalize(input);
  const b = normalize(target);
  if (!a || !b) return false;
  if (a === b) return true;
  // Allow ~15% of the target's length in edits (at least 1) for typos.
  const tolerance = Math.max(1, Math.floor(b.length * 0.15));
  return levenshtein(a, b) <= tolerance;
}

/** First two words of a scientific name, i.e. "Genus species" without subspecies. */
function genusSpecies(scientificName: string): string {
  return scientificName.split(/\s+/).slice(0, 2).join(" ");
}

/**
 * Hard mode wants the common name, but knowing the Latin is at least as hard,
 * so we accept either. Botanist mode requires the scientific name.
 */
export function matchesAnswer(
  input: string,
  mode: "hard" | "botanist",
  scientificName: string,
  commonName: string | null,
): boolean {
  const candidates: string[] = [];
  if (mode === "hard" && commonName) candidates.push(commonName);
  candidates.push(scientificName, genusSpecies(scientificName));
  return candidates.some((c) => closeEnough(input, c));
}
