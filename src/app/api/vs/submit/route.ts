import { createClient } from "@/lib/supabase/server";
import { createAdminClient, adminEnabled } from "@/lib/supabase/admin";
import { openAnswer } from "@/lib/sign";
import { matchesAnswer } from "@/lib/match";

interface Guess {
  taxonId?: number;
  text?: string;
}

// Score one round's guess against its sealed answer — mirrors /api/guess so the
// VS score is computed and trusted server-side, not taken from the client.
function isCorrect(token: string, guess: Guess, mode: "normal" | "hard" | "botanist"): boolean {
  const answer = openAnswer(token);
  if (!answer) return false;
  if (typeof guess.taxonId === "number") return guess.taxonId === answer.taxonId;
  if (typeof guess.text === "string" && (mode === "hard" || mode === "botanist")) {
    return matchesAnswer(guess.text, mode, answer.scientificName, answer.commonName);
  }
  return false;
}

export async function POST(request: Request) {
  if (!adminEnabled) {
    return Response.json({ error: "VS mode is not configured on the server." }, { status: 503 });
  }

  let body: { matchId?: string; guesses?: Guess[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { matchId, guesses } = body;
  if (typeof matchId !== "string" || !Array.isArray(guesses)) {
    return Response.json({ error: "Missing matchId or guesses." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: match } = await admin.from("matches").select("*").eq("id", matchId).single();

  if (!match) return Response.json({ error: "Match not found." }, { status: 404 });
  const isChallenger = match.challenger === user.id;
  const isOpponent = match.opponent === user.id;
  if (!isChallenger && !isOpponent) {
    return Response.json({ error: "You're not in this match." }, { status: 403 });
  }
  if (match.status !== "active") {
    return Response.json({ error: "This match isn't active." }, { status: 409 });
  }

  const myScoreColumn = isChallenger ? "challenger_score" : "opponent_score";
  if (match[myScoreColumn] != null) {
    return Response.json({ error: "You've already submitted this match." }, { status: 409 });
  }

  const rounds = (match.rounds ?? []) as { token: string }[];
  let score = 0;
  for (let i = 0; i < rounds.length; i++) {
    if (guesses[i] && isCorrect(rounds[i].token, guesses[i], match.mode)) score++;
  }

  const otherScore = isChallenger ? match.opponent_score : match.challenger_score;
  const update: Record<string, unknown> = {
    [myScoreColumn]: score,
    updated_at: new Date().toISOString(),
  };
  // If the other player already finished, this submission completes the match.
  if (otherScore != null) update.status = "complete";

  const { error } = await admin.from("matches").update(update).eq("id", matchId);
  if (error) {
    return Response.json({ error: "Failed to save your result." }, { status: 500 });
  }

  return Response.json({ score, total: rounds.length });
}
