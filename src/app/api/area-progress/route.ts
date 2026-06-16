import type { NextRequest } from "next/server";
import { getAreaPool, RoundError, type GameMode } from "@/lib/inat";
import { getCorrectTaxa } from "@/lib/mastery";
import { groupsToTaxonFilter } from "@/lib/taxonGroups";

const MODES: GameMode[] = ["normal", "hard", "botanist"];

/**
 * "You've identified x of y species in this area" for the signed-in player and
 * the given mode. y is the area's distinct research-grade plant species; x is how
 * many of those they've correctly identified in this mode. Returns zeros for
 * guests (tracking is signed-in only).
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  const radius = Math.min(200, Math.max(1, Number(sp.get("radius")) || 25));
  const modeParam = sp.get("mode") as GameMode | null;
  const mode = modeParam && MODES.includes(modeParam) ? modeParam : "normal";
  const filter = groupsToTaxonFilter((sp.get("groups") ?? "").split(",").filter(Boolean));

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return Response.json({ error: "Invalid coordinates." }, { status: 400 });
  }

  try {
    const [pool, correctTaxa] = await Promise.all([
      getAreaPool(lat, lng, radius, filter),
      getCorrectTaxa(mode),
    ]);
    const guessed = correctTaxa.filter((id) => pool.ids.has(id)).length;
    return Response.json({ guessed, total: pool.total });
  } catch (e) {
    if (e instanceof RoundError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json({ error: "Failed to load area progress." }, { status: 500 });
  }
}
