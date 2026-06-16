import { sealAnswer } from "./sign";

const API = "https://api.inaturalist.org/v1/observations";

export type GameMode = "normal" | "hard" | "botanist";

// iNaturalist asks API users to identify their app and stay within rate limits.
// https://www.inaturalist.org/pages/api+recommended+practices
const USER_AGENT = "Treeoguessr/0.1 (educational plant ID game)";

export interface RoundOption {
  taxonId: number;
  commonName: string | null;
  scientificName: string;
}

export interface Round {
  photo: {
    url: string;
    attribution: string;
    licenseCode: string | null;
    observationUrl: string;
  };
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

/** One photo for a round — everything the photo panel needs. */
interface PoolPhoto {
  photoUrl: string;
  attribution: string;
  licenseCode: string | null;
  observationUrl: string;
}

/** One distinct species in an area (name only; its photo is fetched on demand). */
interface AreaSpecies {
  taxonId: number;
  scientificName: string;
  commonName: string | null;
}

/** The full species universe for an area, from iNat's species_counts. */
interface AreaPool {
  total: number; // true distinct-species count (the "of y" denominator)
  species: AreaSpecies[]; // every species we paged through (question + distractor pool)
  ids: Set<number>; // taxon ids of `species`, for the "x identified" intersection
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

// When fetching a question photo, look at this many recent local observations of
// the species and pick one at random — gives variety without a deep crawl, and
// the taxon filter keeps the result set tiny (well under the 10k page ceiling).
const PHOTO_CANDIDATES = 30;

async function fetchSpeciesPage(
  rlat: number,
  rlng: number,
  radius: number,
  page: number,
): Promise<{ species: AreaSpecies[]; total: number }> {
  const params = new URLSearchParams({
    lat: String(rlat),
    lng: String(rlng),
    radius: String(radius),
    iconic_taxa: "Plantae",
    quality_grade: "research",
    hrank: "species",
    per_page: String(PER_PAGE),
    page: String(page),
  });
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
export async function getAreaPool(lat: number, lng: number, radius: number): Promise<AreaPool> {
  const rlat = Number(lat.toFixed(3));
  const rlng = Number(lng.toFixed(3));
  const key = `${rlat},${rlng},${radius}`;
  const cached = areaPoolCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.pool;

  // Page 1 gives the total (denominator) and the most-observed species.
  const first = await fetchSpeciesPage(rlat, rlng, radius, 1);
  const byId = new Map<number, AreaSpecies>();
  for (const s of first.species) byId.set(s.taxonId, s);

  const pageCount = Math.min(AREA_PAGE_CAP, Math.ceil(first.total / PER_PAGE));
  if (pageCount > 1) {
    const pages = Array.from({ length: pageCount - 1 }, (_, i) => i + 2);
    const rest = await mapLimit(pages, FETCH_CONCURRENCY, async (page) => {
      try {
        return (await fetchSpeciesPage(rlat, rlng, radius, page)).species;
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
 * A local, research-grade, CC-licensed photo of one species near (rlat,rlng), or
 * null if the species has none nearby. Filtering by taxon keeps this to a single
 * small request that sidesteps the 10k observation-pagination ceiling.
 */
async function fetchLocalPhoto(
  taxonId: number,
  rlat: number,
  rlng: number,
  radius: number,
): Promise<PoolPhoto | null> {
  const params = new URLSearchParams({
    taxon_id: String(taxonId),
    lat: String(rlat),
    lng: String(rlng),
    radius: String(radius),
    quality_grade: "research",
    photos: "true",
    photo_license: PHOTO_LICENSES,
    per_page: String(PHOTO_CANDIDATES),
    order_by: "created_at",
    order: "desc",
  });
  let results: INatObservation[];
  try {
    const res = await fetch(`${API}?${params}`, { headers: API_HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    results = ((await res.json()) as { results?: INatObservation[] }).results ?? [];
  } catch {
    return null;
  }

  // Collect one CC-licensed photo per observation (the matched obs may also carry
  // all-rights-reserved photos), then pick one at random for variety.
  const photos: PoolPhoto[] = [];
  for (const o of results) {
    const photo = (o.photos ?? []).find(
      (p) => p.url && p.license_code && ALLOWED_LICENSE.has(p.license_code),
    );
    if (!photo?.url) continue;
    photos.push({
      photoUrl: toLarge(photo.url),
      attribution: photo.attribution ?? "",
      licenseCode: photo.license_code ?? null,
      observationUrl: `https://www.inaturalist.org/observations/${o.id}`,
    });
  }
  if (photos.length === 0) return null;
  return photos[Math.floor(Math.random() * photos.length)];
}

/**
 * Pick up to `n` distinct question species from `candidates`, each paired with a
 * fetched local photo. Walks the (shuffled) candidates with bounded concurrency,
 * skipping any species that has no usable local photo, and stops as soon as `n`
 * are found — so the common case costs ~`n` photo requests.
 */
async function collectQuestionsWithPhotos(
  candidates: AreaSpecies[],
  n: number,
  rlat: number,
  rlng: number,
  radius: number,
): Promise<{ species: AreaSpecies; photo: PoolPhoto }[]> {
  const shuffled = shuffle([...candidates]);
  const out: { species: AreaSpecies; photo: PoolPhoto }[] = [];
  let next = 0;
  const workers = Math.min(FETCH_CONCURRENCY, Math.max(1, n), shuffled.length);
  async function worker() {
    while (out.length < n && next < shuffled.length) {
      const species = shuffled[next++];
      const photo = await fetchLocalPhoto(species.taxonId, rlat, rlng, radius);
      if (photo && out.length < n) out.push({ species, photo });
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  return out.slice(0, n);
}

/**
 * Build the photo/options/token for one round from a chosen `question` species
 * and its `photo`, drawing 3 distractors from the rest of `pool`. The shared core
 * of solo and VS rounds (everything in a `Round` except `location`).
 */
function assembleRound(
  question: AreaSpecies,
  photo: PoolPhoto,
  pool: AreaSpecies[],
  mode: GameMode,
): Omit<Round, "location"> {
  const distractors = shuffle(pool.filter((p) => p.taxonId !== question.taxonId)).slice(0, 3);

  const options = shuffle(
    [question, ...distractors].map<RoundOption>((p) => ({
      taxonId: p.taxonId,
      commonName: p.commonName,
      scientificName: p.scientificName,
    })),
  );

  return {
    photo: {
      url: photo.photoUrl,
      attribution: photo.attribution,
      licenseCode: photo.licenseCode,
      observationUrl: photo.observationUrl,
    },
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

/**
 * Build one round near (lat,lng). `correctTaxa` are species the player has
 * already mastered in this mode — hidden until the area is exhausted. `cooldown`
 * are the last couple of species shown, kept out for a round or two so nothing
 * repeats back-to-back (a missed species can still return after the cooldown).
 */
export async function buildRound(
  lat: number,
  lng: number,
  radius: number,
  mode: GameMode = "normal",
  correctTaxa: number[] = [],
  cooldown: number[] = [],
): Promise<Round> {
  // Round coordinates to ~110m: better cache hits and a little privacy.
  const rlat = Number(lat.toFixed(3));
  const rlng = Number(lng.toFixed(3));

  const pool = await getAreaPool(rlat, rlng, radius);

  if (pool.species.length < 4) {
    throw new RoundError(
      "Not enough research-grade plants nearby. Try increasing the range.",
      404,
    );
  }

  // Hide species already mastered in this mode. Only once the area's unguessed
  // species are exhausted do we fall back to the full pool (allowing a repeat).
  const correctSet = new Set(correctTaxa);
  let candidates = pool.species.filter((p) => !correctSet.has(p.taxonId));
  // Hard mode asks for the common name, so prefer a question that has one.
  if (mode === "hard" && candidates.some((p) => p.commonName)) {
    candidates = candidates.filter((p) => p.commonName);
  }
  if (candidates.length === 0) candidates = pool.species;

  // Keep the last couple of shown species out so nothing repeats immediately;
  // relax if that would leave nothing to ask.
  const cooldownSet = new Set(cooldown);
  const fresh = candidates.filter((p) => !cooldownSet.has(p.taxonId));
  const available = fresh.length > 0 ? fresh : candidates;

  const picked = await collectQuestionsWithPhotos(available, 1, rlat, rlng, radius);
  if (picked.length === 0) {
    throw new RoundError(
      "Couldn't find a usable plant photo nearby. Try increasing the range.",
      404,
    );
  }

  return {
    ...assembleRound(picked[0].species, picked[0].photo, pool.species, mode),
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

/** Pick `n` question species (with photos) from a location's pool, preferring
 *  ones with a common name in hard mode. Throws if the area can't supply enough. */
async function pickMatchQuestions(
  loc: MatchLocation,
  pool: AreaPool,
  n: number,
  mode: GameMode,
): Promise<{ species: AreaSpecies; photo: PoolPhoto }[]> {
  let candidates = pool.species;
  if (mode === "hard") {
    const named = pool.species.filter((p) => p.commonName);
    if (named.length >= n) candidates = named;
  }
  const picked = await collectQuestionsWithPhotos(
    candidates,
    n,
    Number(loc.lat.toFixed(3)),
    Number(loc.lng.toFixed(3)),
    loc.radius,
  );
  if (picked.length < n) {
    throw new RoundError(
      "Not enough research-grade plants in one of the areas. Try a wider search range.",
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

  const [cQuestions, oQuestions] = await Promise.all([
    pickMatchQuestions(challengerLoc, cPool, half, mode),
    pickMatchQuestions(opponentLoc, oPool, half, mode),
  ]);

  const rounds: MatchRound[] = [];
  for (let i = 0; i < half; i++) {
    rounds.push({
      ...assembleRound(cQuestions[i].species, cQuestions[i].photo, cPool.species, mode),
      owner: "challenger",
    });
    rounds.push({
      ...assembleRound(oQuestions[i].species, oQuestions[i].photo, oPool.species, mode),
      owner: "opponent",
    });
  }
  return rounds;
}
