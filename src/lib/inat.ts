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
  };
  photos?: INatPhoto[];
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

/** One distinct species in an area, trimmed to just what a round needs. */
interface PoolItem {
  taxonId: number;
  scientificName: string;
  commonName: string | null;
  photoUrl: string;
  attribution: string;
  licenseCode: string | null;
  observationUrl: string;
}

const POOL_TTL_MS = 30 * 60 * 1000;
// In-memory cache of trimmed species pools. We can't use Next's fetch cache
// here because the raw iNat response (~12MB for 200 obs) exceeds its 2MB limit,
// so we cache only the small trimmed pool ourselves, keyed by area + radius.
const poolCache = new Map<string, { pool: PoolItem[]; expires: number }>();

async function getPool(rlat: number, rlng: number, radius: number): Promise<PoolItem[]> {
  const key = `${rlat},${rlng},${radius}`;
  const cached = poolCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.pool;

  const params = new URLSearchParams({
    lat: String(rlat),
    lng: String(rlng),
    radius: String(radius),
    iconic_taxa: "Plantae",
    quality_grade: "research",
    photos: "true",
    photo_license: "cc0,cc-by,cc-by-nc",
    per_page: "200",
    order_by: "created_at",
    order: "desc",
  });

  const res = await fetch(`${API}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new RoundError("iNaturalist API is unavailable right now.", 502);
  }

  const data = (await res.json()) as { results?: INatObservation[] };
  const observations = (data.results ?? []).filter(
    (o) => o.taxon && o.photos && o.photos.length > 0 && o.photos[0].url,
  );

  // One entry per distinct species — gives plausible local distractors.
  const byTaxon = new Map<number, PoolItem>();
  for (const o of observations) {
    const taxon = o.taxon!;
    if (byTaxon.has(taxon.id)) continue;
    const photo = o.photos![0];
    byTaxon.set(taxon.id, {
      taxonId: taxon.id,
      scientificName: taxon.name,
      commonName: taxon.preferred_common_name ?? null,
      photoUrl: toLarge(photo.url!),
      attribution: photo.attribution ?? "",
      licenseCode: photo.license_code ?? null,
      observationUrl: `https://www.inaturalist.org/observations/${o.id}`,
    });
  }

  const pool = [...byTaxon.values()];
  poolCache.set(key, { pool, expires: Date.now() + POOL_TTL_MS });
  return pool;
}

export async function buildRound(
  lat: number,
  lng: number,
  radius: number,
  mode: GameMode = "normal",
  exclude: number[] = [],
): Promise<Round> {
  // Round coordinates to ~110m: better cache hits and a little privacy.
  const rlat = Number(lat.toFixed(3));
  const rlng = Number(lng.toFixed(3));

  const pool = await getPool(rlat, rlng, radius);

  if (pool.length < 4) {
    throw new RoundError(
      "Not enough research-grade plant photos nearby. Try increasing the range.",
      404,
    );
  }

  // Don't repeat a species already seen this game (the same species would show
  // the identical photo). Fall back to the full pool only once it's exhausted.
  const excludeSet = new Set(exclude);
  let questionPool = pool.filter((p) => !excludeSet.has(p.taxonId));
  // Hard mode asks for the common name, so prefer a question that has one.
  if (mode === "hard" && questionPool.some((p) => p.commonName)) {
    questionPool = questionPool.filter((p) => p.commonName);
  }
  if (questionPool.length === 0) questionPool = pool;
  const question = questionPool[Math.floor(Math.random() * questionPool.length)];

  const distractors = shuffle(
    pool.filter((p) => p.taxonId !== question.taxonId),
  ).slice(0, 3);

  const options = shuffle(
    [question, ...distractors].map<RoundOption>((p) => ({
      taxonId: p.taxonId,
      commonName: p.commonName,
      scientificName: p.scientificName,
    })),
  );

  return {
    photo: {
      url: question.photoUrl,
      attribution: question.attribution,
      licenseCode: question.licenseCode,
      observationUrl: question.observationUrl,
    },
    // Reveal options up front only in normal mode; otherwise unlock via lifeline.
    options: mode === "normal" ? options : null,
    token: sealAnswer({
      taxonId: question.taxonId,
      scientificName: question.scientificName,
      commonName: question.commonName,
      options,
    }),
    location: { lat: rlat, lng: rlng, radius },
  };
}
