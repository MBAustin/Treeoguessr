import { getSupabaseBrowser } from "./supabase/client";
import type { GameMode } from "./inat";

export interface ModeStats {
  mode: GameMode;
  correct: number;
  incorrect: number;
  speciesIdentified: number;
}

const MODES: GameMode[] = ["normal", "hard", "botanist"];

/**
 * Per-mode mastery stats for the signed-in player, or null if not signed in /
 * Supabase isn't configured. Always returns a row per mode (zeros when unplayed)
 * so the Profile page can render a stable table.
 */
export async function getProfileStats(): Promise<ModeStats[] | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return null;
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;

  // RLS scopes this to the current user's rows.
  const { data } = await sb
    .from("species_guesses")
    .select("mode, correct_count, incorrect_count");

  const byMode = new Map<GameMode, ModeStats>(
    MODES.map((mode) => [mode, { mode, correct: 0, incorrect: 0, speciesIdentified: 0 }]),
  );
  for (const row of data ?? []) {
    const stats = byMode.get(row.mode as GameMode);
    if (!stats) continue;
    stats.correct += row.correct_count ?? 0;
    stats.incorrect += row.incorrect_count ?? 0;
    if ((row.correct_count ?? 0) > 0) stats.speciesIdentified += 1;
  }
  return MODES.map((mode) => byMode.get(mode)!);
}
