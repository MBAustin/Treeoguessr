import { openAnswer } from "@/lib/sign";
import { matchesAnswer } from "@/lib/match";
import { recordGuess } from "@/lib/mastery";
import type { GameMode } from "@/lib/inat";

const MODES: GameMode[] = ["normal", "hard", "botanist"];

export async function POST(request: Request) {
  let body: { token?: string; taxonId?: number; text?: string; mode?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { token, taxonId, text, mode } = body;
  if (typeof token !== "string") {
    return Response.json({ error: "Missing token." }, { status: 400 });
  }

  const answer = openAnswer(token);
  if (answer == null) {
    return Response.json({ error: "Invalid or tampered token." }, { status: 400 });
  }

  let correct: boolean;
  if (typeof taxonId === "number") {
    // Multiple-choice guess (normal mode, or a typed mode after a lifeline).
    correct = taxonId === answer.taxonId;
  } else if (typeof text === "string" && (mode === "hard" || mode === "botanist")) {
    // Typed guess.
    correct = matchesAnswer(text, mode, answer.scientificName, answer.commonName);
  } else {
    return Response.json({ error: "Provide a taxonId or text + mode." }, { status: 400 });
  }

  // Record against the signed-in player's profile (no-op for guests). The mode
  // determines which per-mode tally this counts toward.
  const guessMode: GameMode = MODES.includes(mode as GameMode) ? (mode as GameMode) : "normal";
  await recordGuess(
    guessMode,
    answer.taxonId,
    answer.scientificName,
    answer.commonName,
    correct,
  );

  return Response.json({
    correct,
    correctTaxonId: answer.taxonId,
    scientificName: answer.scientificName,
    commonName: answer.commonName,
  });
}
