import { createClient } from "@/lib/supabase/server";
import { createAdminClient, adminEnabled } from "@/lib/supabase/admin";
import { buildRoundsForLocations, RoundError, type MatchLocation } from "@/lib/inat";

function parseLocation(raw: unknown): MatchLocation | null {
  if (!raw || typeof raw !== "object") return null;
  const { lat, lng, radius } = raw as Record<string, unknown>;
  const nlat = Number(lat);
  const nlng = Number(lng);
  if (
    !Number.isFinite(nlat) ||
    !Number.isFinite(nlng) ||
    nlat < -90 ||
    nlat > 90 ||
    nlng < -180 ||
    nlng > 180
  ) {
    return null;
  }
  return { lat: nlat, lng: nlng, radius: Math.min(200, Math.max(1, Number(radius) || 25)) };
}

// The opponent accepts a pending challenge and shares their location. We freeze
// the 16 rounds (half from each player's area) into the match here, server-side,
// so both players replay the identical set.
export async function POST(request: Request) {
  if (!adminEnabled) {
    return Response.json({ error: "VS mode is not configured on the server." }, { status: 503 });
  }

  let body: { matchId?: string; location?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { matchId } = body;
  const location = parseLocation(body.location);
  if (typeof matchId !== "string" || !location) {
    return Response.json({ error: "Missing matchId or valid location." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: match } = await admin.from("matches").select("*").eq("id", matchId).single();

  if (!match) return Response.json({ error: "Match not found." }, { status: 404 });
  if (match.opponent !== user.id) {
    return Response.json({ error: "You're not the opponent in this match." }, { status: 403 });
  }
  if (match.status !== "pending") {
    return Response.json({ error: "This challenge can no longer be accepted." }, { status: 409 });
  }

  let rounds;
  try {
    rounds = await buildRoundsForLocations(match.challenger_loc, location, match.mode);
  } catch (e) {
    if (e instanceof RoundError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json({ error: "Failed to build the match." }, { status: 500 });
  }

  const { error } = await admin
    .from("matches")
    .update({
      opponent_loc: location,
      rounds,
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", matchId)
    .eq("status", "pending"); // guard against a concurrent accept

  if (error) {
    return Response.json({ error: "Failed to start the match." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
