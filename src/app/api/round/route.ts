import type { NextRequest } from "next/server";
import { buildRound, RoundError, type GameMode, type PhotoStore } from "@/lib/inat";
import { getSeenPhotos, recordSeenPhotos, getRecentTaxa } from "@/lib/mastery";
import { groupsToTaxonFilter } from "@/lib/taxonGroups";

const photoStore: PhotoStore = {
  getSeen: getSeenPhotos,
  recordSeen: recordSeenPhotos,
};

const MODES: GameMode[] = ["normal", "hard", "botanist"];

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  const radius = Math.min(200, Math.max(1, Number(sp.get("radius")) || 25));
  const modeParam = sp.get("mode") as GameMode | null;
  const mode = modeParam && MODES.includes(modeParam) ? modeParam : "normal";
  // Species already shown this game (client-tracked), never repeated within a game.
  const seen = (sp.get("seen") ?? "")
    .split(",")
    .map(Number)
    .filter(Number.isFinite);
  // Selected organism-type group keys → an iNat include/exclude filter.
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
    const recentTaxa = await getRecentTaxa(mode);
    const round = await buildRound(lat, lng, radius, mode, seen, recentTaxa, filter, photoStore);
    return Response.json(round);
  } catch (e) {
    if (e instanceof RoundError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json({ error: "Failed to build a round." }, { status: 500 });
  }
}
