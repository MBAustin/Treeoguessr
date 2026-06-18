import { getSupabaseBrowser } from "./supabase/client";
import type { GameMode } from "./inat";

export interface ModeStats {
  mode: GameMode;
  correct: number;
  incorrect: number;
  speciesIdentified: number;
}

export interface TopSpecies {
  taxonId: number;
  name: string; // common name if known, else scientific
  scientificName: string;
  count: number;
}

export interface ProfileStats {
  byMode: ModeStats[];
  topCorrect: TopSpecies[];
  topIncorrect: TopSpecies[];
}

const MODES: GameMode[] = ["normal", "hard", "botanist"];
const TOP_N = 5;

/**
 * Mastery stats for the signed-in player (per-mode tallies plus most-identified
 * and most-missed species), or null if not signed in / Supabase isn't configured.
 */
export async function getProfileStats(): Promise<ProfileStats | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return null;
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;

  // RLS scopes this to the current user's rows.
  const { data } = await sb
    .from("species_guesses")
    .select("mode, taxon_id, scientific_name, common_name, correct_count, incorrect_count");
  const rows = data ?? [];

  const byMode = new Map<GameMode, ModeStats>(
    MODES.map((mode) => [mode, { mode, correct: 0, incorrect: 0, speciesIdentified: 0 }]),
  );
  // Aggregate per taxon (across modes) for the top lists.
  const byTaxon = new Map<
    number,
    { scientificName: string; commonName: string | null; correct: number; incorrect: number }
  >();

  for (const row of rows) {
    const mode = byMode.get(row.mode as GameMode);
    if (mode) {
      mode.correct += row.correct_count ?? 0;
      mode.incorrect += row.incorrect_count ?? 0;
      if ((row.correct_count ?? 0) > 0) mode.speciesIdentified += 1;
    }
    const id = Number(row.taxon_id);
    const cur = byTaxon.get(id) ?? {
      scientificName: row.scientific_name,
      commonName: row.common_name ?? null,
      correct: 0,
      incorrect: 0,
    };
    cur.correct += row.correct_count ?? 0;
    cur.incorrect += row.incorrect_count ?? 0;
    if (!cur.commonName && row.common_name) cur.commonName = row.common_name;
    byTaxon.set(id, cur);
  }

  const entries = [...byTaxon.entries()].map(([taxonId, v]) => ({
    taxonId,
    name: v.commonName ?? v.scientificName,
    scientificName: v.scientificName,
    correct: v.correct,
    incorrect: v.incorrect,
  }));
  const top = (key: "correct" | "incorrect"): TopSpecies[] =>
    entries
      .filter((e) => e[key] > 0)
      .sort((a, b) => b[key] - a[key])
      .slice(0, TOP_N)
      .map((e) => ({ taxonId: e.taxonId, name: e.name, scientificName: e.scientificName, count: e[key] }));

  return {
    byMode: MODES.map((mode) => byMode.get(mode)!),
    topCorrect: top("correct"),
    topIncorrect: top("incorrect"),
  };
}

/** Clear the player's seen-photo history, so every photo can appear fresh again. */
export async function resetSeenPhotos(): Promise<void> {
  const sb = getSupabaseBrowser();
  if (!sb) return;
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return;
  await sb.from("seen_photos").delete().eq("user_id", user.id);
}

/** Wipe everything: identified species, seen-photo history, and game scores. */
export async function resetAllData(): Promise<void> {
  const sb = getSupabaseBrowser();
  if (!sb) return;
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return;
  await Promise.all([
    sb.from("species_guesses").delete().eq("user_id", user.id),
    sb.from("seen_photos").delete().eq("user_id", user.id),
    sb.from("game_results").delete().eq("user_id", user.id),
  ]);
}
