import { sealAnswer } from "./sign";
import { DEFAULT_FILTER, type TaxonFilter } from "./taxonGroups";

const API = "https://api.inaturalist.org/v1/observations";

export type GameMode = "normal" | "hard" | "botanist";

// iNaturalist asks API users to identify their app and stay within rate limits.
// https://www.inaturalist.org/pages/api+recommended+practices
const USER_AGENT = "Treeoguessr/0.1 (educational nature ID game)";

export interface RoundOption {
  taxonId: number;
  commonName: string | null;
  scientificName: string;
}

export interface RoundPhoto {
  url: string;
  attribution: string;
  licenseCode: string | null;
  observationUrl: string;
}

export interface Round {
  // One or more local photos of the answer species — shown as a carousel client
  // side so the player can see several specimens when enough exist nearby.
  photos: RoundPhoto[];
  // Options are only sent in the clear for normal mode. In hard/botanist mode
  // they stay sealed in the token and are revealed via /api/lifeline.
  options: RoundOption[] | null;
  token: string;
  location: { lat: number; lng: number; radius: number };
}

/** An error carrying an HTTP status for the route handler to surface. */
export class RoundError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface INatPhoto {
  id?: number;
  url?: string;
  attribution?: string;
  license_code?: string | null;
}

interface INatObservation {
  id: number;
  taxon?: {
    id: number;
    name: string;
    preferred_common_name?: string | null;
    // iNat rank level: species = 10, subspecies/variety/form < 10, genus = 20…
    rank_level?: number | null;
    // Ancestor taxon ids ordered root→self; a longer shared prefix between two
    // species means a more recent common ancestor (genus > family > order…).
    ancestor_ids?: number[] | null;
  };
  photos?: INatPhoto[];
}

const API_HEADERS = { "User-Agent": USER_AGENT, Accept: "application/json" };
// Photo licenses we're allowed to display. Used both to filter the iNat query
// and to pick the right photo off an observation that has several.
const PHOTO_LICENSES = "cc0,cc-by,cc-by-nc";
const ALLOWED_LICENSE = new Set(["cc0", "cc-by", "cc-by-nc"]);

/**
 * Keep only taxa identified to species (or finer), so every round has a real
 * "Genus species" answer. Prefers iNat's rank_level; falls back to requiring a
 * binomial name when it's absent.
 */
function isSpeciesLevel(taxon: NonNullable<INatObservation["taxon"]>): boolean {
  if (typeof taxon.rank_level === "number") return taxon.rank_level <= 10;
  return taxon.name.trim().split(/\s+/).length >= 2;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Order items by weighted random sampling — higher weight ⇒ likelier to come
 *  first (Efraimidis–Spirakis). Weight 0 items still appear, just usually last. */
function weightedOrder<T>(items: T[], weight: (item: T) => number): T[] {
  return items
    .map((item) => ({ item, key: Math.random() ** (1 / Math.max(weight(item), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.item);
}

/** Upgrade an iNaturalist thumbnail URL to a larger display size. */
function toLarge(url: string): string {
  return url.replace(/\/square\.(\w+)/, "/large.$1");
}

/** Map over items running at most `limit` concurrently — keeps cold area fetches
 *  from firing dozens of iNat requests at once and tripping the rate limit. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** One photo for a round — everything the photo panel needs, plus the iNat photo
 *  id used to avoid repeating photos a player has already seen. */
interface PoolPhoto {
  photoUrl: string;
  attribution: string;
  licenseCode: string | null;
  observationUrl: string;
  photoId: number;
}

/**
 * Per-player record of which photos have already been shown, so the same species
 * can recur across games without repeating a photo. Implemented over Supabase by
 * the round route; absent (guest) means no cross-game memory.
 */
export interface PhotoStore {
  getSeen: (photoIds: number[]) => Promise<Set<number>>;
  recordSeen: (photoIds: number[]) => Promise<void>;
}

/** One distinct species in an area (name only; its photo is fetched on demand). */
interface AreaSpecies {
  taxonId: number;
  scientificName: string;
  commonName: string | null;
  // Ancestor taxon ids (root→self), used to pick taxonomically close distractors.
  ancestorIds: number[];
}

/** The full species universe for an area, from iNat's species_counts. */
export interface AreaPool {
  total: number; // true distinct-species count (the "of y" denominator)
  species: AreaSpecies[]; // every species we paged through (question + distractor pool)
  ids: Set<number>; // taxon ids of `species`, for the "x identified" intersection
}

/** Normal and Hard rely on recognizable names; Taxonomist (internal id `botanist`)
 *  asks for the scientific name, so it allows species that have no common name. */
function requireCommonName(mode: GameMode): boolean {
  return mode !== "botanist";
}

/**
 * "x of y" for the area counter, respecting the mode's common-name requirement
 * so the denominator matches the species that mode can actually quiz.
 */
export function areaIdentified(
  pool: AreaPool,
  correctTaxa: number[],
  mode: GameMode,
): { guessed: number; total: number } {
  const species = requireCommonName(mode)
    ? pool.species.filter((s) => s.commonName)
    : pool.species;
  const ids = new Set(species.map((s) => s.taxonId));
  let guessed = 0;
  for (const id of new Set(correctTaxa)) if (ids.has(id)) guessed++;
  return { guessed, total: species.length };
}

const PER_PAGE = 200;
// species_counts pages to walk. 50 * 200 = 10,000 = iNat's pagination ceiling,
// which is more distinct species than any real local area holds — so in practice
// we page through *all* of an area's species. Typical areas need far fewer pages
// (≈ ceil(total / 200)); this is just the safety bound.
const AREA_PAGE_CAP = 50;
// Cap concurrent iNat requests during a cold area/photo fetch, to stay polite.
const FETCH_CONCURRENCY = 5;
// The species list changes slowly, so cache it for an hour. The same cache backs
// both round building and the "x of y" counter, so they share one species universe.
const AREA_TTL_MS = 60 * 60 * 1000;
const areaPoolCache = new Map<string, { pool: AreaPool; expires: number }>();

// Photos shown per question. Two when available, one when that's all that's left.
const MAX_PHOTOS_PER_ROUND = 2;
// We page through ~all local research-grade observations of a species (so every
// available photo is reachable over time), bounded for safety. A single species
// in one area rarely exceeds a few hundred.
const PHOTO_PER_PAGE = 200;
const PHOTO_PAGE_CAP = 15;
const PHOTO_TTL_MS = 30 * 60 * 1000;
// Candidate photos per species+area, cached so we don't re-crawl each round.
const photoCache = new Map<string, { photos: PoolPhoto[]; expires: number }>();

async function fetchSpeciesPage(
  rlat: number,
  rlng: number,
  radius: number,
  page: number,
  filter: TaxonFilter,
): Promise<{ species: AreaSpecies[]; total: number }> {
  const params = new URLSearchParams({
    lat: String(rlat),
    lng: String(rlng),
    radius: String(radius),
    quality_grade: "research",
    hrank: "species",
    per_page: String(PER_PAGE),
    page: String(page),
  });
  // Restrict to the chosen organism groups: include these taxa, minus any in the
  // exclude list (which expresses an "Other = parent minus named subgroups" set).
  params.set("taxon_id", filter.include.join(","));
  if (filter.exclude.length) params.set("without_taxon_id", filter.exclude.join(","));
  const res = await fetch(`${API}/species_counts?${params}`, {
    headers: API_HEADERS,
    cache: "no-store",
  });
  if (!res.ok) throw new RoundError("iNaturalist API is unavailable right now.", 502);
  const data = (await res.json()) as {
    total_results?: number;
    results?: { taxon?: INatObservation["taxon"] }[];
  };
  const species: AreaSpecies[] = [];
  for (const r of data.results ?? []) {
    const t = r.taxon;
    if (!t || typeof t.id !== "number" || typeof t.name !== "string") continue;
    if (!isSpeciesLevel(t)) continue;
    species.push({
      taxonId: t.id,
      scientificName: t.name,
      commonName: t.preferred_common_name ?? null,
      ancestorIds: t.ancestor_ids ?? [],
    });
  }
  return { species, total: data.total_results ?? 0 };
}

/**
 * The full set of research-grade plant species in an area (from species_counts),
 * with the true `total` for the denominator. Cached per area for an hour; extra
 * pages are best-effort so a transient hiccup just trims the tail rather than
 * failing the whole thing.
 */
export async function getAreaPool(
  lat: number,
  lng: number,
  radius: number,
  filter: TaxonFilter = DEFAULT_FILTER,
): Promise<AreaPool> {
  const rlat = Number(lat.toFixed(3));
  const rlng = Number(lng.toFixed(3));
  const key = `${rlat},${rlng},${radius},${filter.include.join(".")}-${filter.exclude.join(".")}`;
  const cached = areaPoolCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.pool;

  // Page 1 gives the total (denominator) and the most-observed species.
  const first = await fetchSpeciesPage(rlat, rlng, radius, 1, filter);
  const byId = new Map<number, AreaSpecies>();
  for (const s of first.species) byId.set(s.taxonId, s);

  const pageCount = Math.min(AREA_PAGE_CAP, Math.ceil(first.total / PER_PAGE));
  if (pageCount > 1) {
    const pages = Array.from({ length: pageCount - 1 }, (_, i) => i + 2);
    const rest = await mapLimit(pages, FETCH_CONCURRENCY, async (page) => {
      try {
        return (await fetchSpeciesPage(rlat, rlng, radius, page, filter)).species;
      } catch {
        return [] as AreaSpecies[];
      }
    });
    for (const list of rest) for (const s of list) if (!byId.has(s.taxonId)) byId.set(s.taxonId, s);
  }

  const pool: AreaPool = {
    total: first.total,
    species: [...byId.values()],
    ids: new Set(byId.keys()),
  };
  areaPoolCache.set(key, { pool, expires: Date.now() + AREA_TTL_MS });
  return pool;
}

/**
 * All local, research-grade, CC-licensed photos of one species near (rlat,rlng),
 * one per observation — paged through up to PHOTO_PAGE_CAP so every available
 * photo is reachable over time, and cached per species+area. Filtering by taxon
 * keeps each page small and sidesteps the 10k observation-pagination ceiling.
 */
async function fetchLocalPhotos(
  taxonId: number,
  rlat: number,
  rlng: number,
  radius: number,
): Promise<PoolPhoto[]> {
  const key = `${taxonId},${rlat},${rlng},${radius}`;
  const cached = photoCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.photos;

  const fetchPage = async (page: number): Promise<{ photos: PoolPhoto[]; total: number }> => {
    const params = new URLSearchParams({
      taxon_id: String(taxonId),
      lat: String(rlat),
      lng: String(rlng),
      radius: String(radius),
      quality_grade: "research",
      photos: "true",
      photo_license: PHOTO_LICENSES,
      per_page: String(PHOTO_PER_PAGE),
      page: String(page),
      order_by: "created_at",
      order: "desc",
    });
    const res = await fetch(`${API}?${params}`, { headers: API_HEADERS, cache: "no-store" });
    if (!res.ok) throw new RoundError("iNaturalist API is unavailable right now.", 502);
    const data = (await res.json()) as { results?: INatObservation[]; total_results?: number };
    const photos: PoolPhoto[] = [];
    for (const o of data.results ?? []) {
      const observationUrl = `https://www.inaturalist.org/observations/${o.id}`;
      // Every CC-licensed photo on the observation — some carry several angles of
      // the same specimen, each usable as a distinct question photo. (A matched
      // obs may also carry all-rights-reserved photos, which we skip.)
      for (const photo of o.photos ?? []) {
        if (!photo.url || typeof photo.id !== "number") continue;
        if (!photo.license_code || !ALLOWED_LICENSE.has(photo.license_code)) continue;
        photos.push({
          photoUrl: toLarge(photo.url),
          attribution: photo.attribution ?? "",
          licenseCode: photo.license_code,
          observationUrl,
          photoId: photo.id,
        });
      }
    }
    return { photos, total: data.total_results ?? 0 };
  };

  let photos: PoolPhoto[];
  try {
    const first = await fetchPage(1);
    photos = [...first.photos];
    const pageCount = Math.min(PHOTO_PAGE_CAP, Math.ceil(first.total / PHOTO_PER_PAGE));
    if (pageCount > 1) {
      const rest = await mapLimit(
        Array.from({ length: pageCount - 1 }, (_, i) => i + 2),
        FETCH_CONCURRENCY,
        async (page) => {
          try {
            return (await fetchPage(page)).photos;
          } catch {
            return [] as PoolPhoto[];
          }
        },
      );
      for (const p of rest) photos.push(...p);
    }
  } catch {
    return [];
  }

  photoCache.set(key, { photos, expires: Date.now() + PHOTO_TTL_MS });
  return photos;
}

/**
 * Choose up to MAX_PHOTOS_PER_ROUND photos from a species' candidate photos,
 * preferring observations the player hasn't seen (via `store`) and reusing seen
 * ones only when nothing fresh remains. Records the chosen photos as seen.
 */
async function selectRoundPhotos(candidates: PoolPhoto[], store?: PhotoStore): Promise<PoolPhoto[]> {
  if (candidates.length === 0) return [];
  const seen = store ? await store.getSeen(candidates.map((p) => p.photoId)) : new Set<number>();
  const unseen = shuffle(candidates.filter((p) => !seen.has(p.photoId)));
  const reused = shuffle(candidates.filter((p) => seen.has(p.photoId)));
  const chosen = [...unseen, ...reused].slice(0, MAX_PHOTOS_PER_ROUND);
  if (store && chosen.length) await store.recordSeen(chosen.map((p) => p.photoId));
  return chosen;
}

/**
 * Pick up to `n` distinct question species from `candidates` (taken in the order
 * given — callers pre-order for randomness/preference), each paired with its
 * fetched local photos. Walks with bounded concurrency, skipping any species with
 * no usable local photo, and stops as soon as `n` are found.
 */
async function collectQuestionsWithPhotos(
  candidates: AreaSpecies[],
  n: number,
  rlat: number,
  rlng: number,
  radius: number,
): Promise<{ species: AreaSpecies; photos: PoolPhoto[] }[]> {
  const out: { species: AreaSpecies; photos: PoolPhoto[] }[] = [];
  let next = 0;
  const workers = Math.min(FETCH_CONCURRENCY, Math.max(1, n), candidates.length);
  async function worker() {
    while (out.length < n && next < candidates.length) {
      const species = candidates[next++];
      const photos = await fetchLocalPhotos(species.taxonId, rlat, rlng, radius);
      if (photos.length > 0 && out.length < n) out.push({ species, photos });
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  return out.slice(0, n);
}

/** How many leading ancestor ids two species share — i.e. the depth of their
 *  most recent common ancestor. Higher = more closely related. */
function sharedAncestry(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

// Distractors should share at least this many leading ancestors with the answer
// — i.e. belong to the same broad group (mosses, ferns, conifers, grasses/other
// monocots, broadleaf flowering plants…) rather than the same genus. This avoids
// the giveaway where a moss photo is the only moss among the options, without
// making every round a near-impossible same-genus quiz. It's a shared-prefix
// count, not an exact rank, so it's approximate: raise it for harder (more
// closely related) options, lower it for easier ones.
const DISTRACTOR_MIN_SHARED = 5;

// Mammalia. Mammals are far easier to tell apart at the broad-group level (a seal
// vs a squirrel is no contest), so for them we want the *closest* relatives
// instead — other seals/sea lions, other mice, etc. Using Infinity here means no
// species clears the "same broad group" bar, so selection always falls through to
// the closest-by-ancestry list below.
const MAMMALIA = 40151;

/**
 * Pick `n` distractor species for `question`. For most taxa that means the same
 * broad group (see DISTRACTOR_MIN_SHARED), chosen at random for variety; for
 * mammals it means the taxonomically closest species. Either way, if the area is
 * thin on relatives we top up with the next-closest so we always return `n`.
 */
function pickDistractors(question: AreaSpecies, pool: AreaSpecies[], n: number): AreaSpecies[] {
  const others = pool.filter((p) => p.taxonId !== question.taxonId);

  const minShared = question.ancestorIds.includes(MAMMALIA) ? Infinity : DISTRACTOR_MIN_SHARED;
  const sameGroup = shuffle(
    others.filter((p) => sharedAncestry(question.ancestorIds, p.ancestorIds) >= minShared),
  );
  if (sameGroup.length >= n) return sameGroup.slice(0, n);

  // Thin on close relatives — top up with the next-closest species available.
  const used = new Set(sameGroup.map((p) => p.taxonId));
  const rest = others
    .filter((p) => !used.has(p.taxonId))
    .map((p) => ({ p, score: sharedAncestry(question.ancestorIds, p.ancestorIds), r: Math.random() }))
    .sort((a, b) => b.score - a.score || a.r - b.r)
    .map((s) => s.p);
  return [...sameGroup, ...rest].slice(0, n);
}

/**
 * Build the photos/options/token for one round from a chosen `question` species
 * and its `photos`, drawing 3 distractors from the rest of `pool`. The shared core
 * of solo and VS rounds (everything in a `Round` except `location`).
 */
function assembleRound(
  question: AreaSpecies,
  photos: PoolPhoto[],
  pool: AreaSpecies[],
  mode: GameMode,
): Omit<Round, "location"> {
  const distractors = pickDistractors(question, pool, 3);

  const options = shuffle(
    [question, ...distractors].map<RoundOption>((p) => ({
      taxonId: p.taxonId,
      commonName: p.commonName,
      scientificName: p.scientificName,
    })),
  );

  return {
    photos: photos.map((p) => ({
      url: p.photoUrl,
      attribution: p.attribution,
      licenseCode: p.licenseCode,
      observationUrl: p.observationUrl,
    })),
    // Reveal options up front only in normal mode; otherwise unlock via lifeline.
    options: mode === "normal" ? options : null,
    token: sealAnswer({
      taxonId: question.taxonId,
      scientificName: question.scientificName,
      commonName: question.commonName,
      options,
    }),
  };
}

// Species seen in recent games are this many times less likely to be the
// question than fresh ones — a soft nudge toward variety, never a hard exclusion.
const RECENT_WEIGHT = 0.1;

/**
 * Build one round near (lat,lng). `seen` are taxa already shown *this game*, which
 * are never repeated. `recentTaxa` are species seen in recent games, softly
 * de-prioritized for variety. `filter` restricts the organism groups. `store`
 * lets a signed-in player avoid photos they've already been shown in earlier games.
 */
export async function buildRound(
  lat: number,
  lng: number,
  radius: number,
  mode: GameMode = "normal",
  seen: number[] = [],
  recentTaxa: number[] = [],
  filter: TaxonFilter = DEFAULT_FILTER,
  store?: PhotoStore,
): Promise<Round> {
  // Round coordinates to ~110m: better cache hits and a little privacy.
  const rlat = Number(lat.toFixed(3));
  const rlng = Number(lng.toFixed(3));

  const pool = await getAreaPool(rlat, rlng, radius, filter);

  // Normal/Hard only quiz species with a common name; Taxonomist uses all.
  const playable = requireCommonName(mode)
    ? pool.species.filter((p) => p.commonName)
    : pool.species;

  if (playable.length < 4) {
    throw new RoundError(
      "Not enough research-grade species nearby. Try a wider range or more types.",
      404,
    );
  }

  // Never repeat a species already shown this game; relax only if that empties
  // the pool (the area has fewer species than the game is long).
  const seenSet = new Set(seen);
  const fresh = playable.filter((p) => !seenSet.has(p.taxonId));
  const available = fresh.length > 0 ? fresh : playable;

  // Order by weighted random, softly de-prioritizing species seen in recent games
  // so play spreads across the area's species over time without ever hard-excluding.
  const recentSet = new Set(recentTaxa);
  const ordered = weightedOrder(available, (p) => (recentSet.has(p.taxonId) ? RECENT_WEIGHT : 1));

  const picked = await collectQuestionsWithPhotos(ordered, 1, rlat, rlng, radius);
  if (picked.length === 0) {
    throw new RoundError("Couldn't find a usable photo nearby. Try increasing the range.", 404);
  }

  const photos = await selectRoundPhotos(picked[0].photos, store);
  return {
    ...assembleRound(picked[0].species, photos, playable, mode),
    location: { lat: rlat, lng: rlng, radius },
  };
}

export interface MatchLocation {
  lat: number;
  lng: number;
  radius: number;
}

/** One frozen VS round: a playable round plus which player's area it came from. */
export interface MatchRound extends Omit<Round, "location"> {
  owner: "challenger" | "opponent";
}

/** Pick `n` question species (with photos) from a candidate list. Throws if the
 *  area can't supply enough. */
async function pickMatchQuestions(
  loc: MatchLocation,
  candidates: AreaSpecies[],
  n: number,
): Promise<{ species: AreaSpecies; photos: PoolPhoto[] }[]> {
  const picked = await collectQuestionsWithPhotos(
    shuffle([...candidates]),
    n,
    Number(loc.lat.toFixed(3)),
    Number(loc.lng.toFixed(3)),
    loc.radius,
  );
  if (picked.length < n) {
    throw new RoundError(
      "Not enough research-grade species in one of the areas. Try a wider search range.",
      404,
    );
  }
  return picked;
}

/**
 * Build a frozen set of `count` rounds for a VS match, sourcing half from each
 * player's location and interleaving them (challenger, opponent, challenger…).
 * Each round's answer is sealed in its token exactly like a solo round, so the
 * frozen set is safe to store and serve to both players.
 */
export async function buildRoundsForLocations(
  challengerLoc: MatchLocation,
  opponentLoc: MatchLocation,
  mode: GameMode = "normal",
  count = 16,
): Promise<MatchRound[]> {
  const half = count / 2;
  const [cPool, oPool] = await Promise.all([
    getAreaPool(challengerLoc.lat, challengerLoc.lng, challengerLoc.radius),
    getAreaPool(opponentLoc.lat, opponentLoc.lng, opponentLoc.radius),
  ]);

  // Normal/Hard only quiz species with a common name; Taxonomist uses all.
  const cPlayable = requireCommonName(mode) ? cPool.species.filter((p) => p.commonName) : cPool.species;
  const oPlayable = requireCommonName(mode) ? oPool.species.filter((p) => p.commonName) : oPool.species;

  const [cQuestions, oQuestions] = await Promise.all([
    pickMatchQuestions(challengerLoc, cPlayable, half),
    pickMatchQuestions(opponentLoc, oPlayable, half),
  ]);

  const rounds: MatchRound[] = [];
  for (let i = 0; i < half; i++) {
    const [cPhotos, oPhotos] = await Promise.all([
      selectRoundPhotos(cQuestions[i].photos),
      selectRoundPhotos(oQuestions[i].photos),
    ]);
    rounds.push({
      ...assembleRound(cQuestions[i].species, cPhotos, cPlayable, mode),
      owner: "challenger",
    });
    rounds.push({
      ...assembleRound(oQuestions[i].species, oPhotos, oPlayable, mode),
      owner: "opponent",
    });
  }
  return rounds;
}
