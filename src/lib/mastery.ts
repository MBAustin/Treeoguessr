import { createClient } from "./supabase/server";
import type { GameMode } from "./inat";

// Tracking is Supabase-backed and signed-in only; everything here no-ops (and
// never throws) for guests or when Supabase isn't configured, so guest play and
// the guess/round routes are unaffected.
const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/** Taxon ids the signed-in player has guessed correctly in `mode`. Empty for guests. */
export async function getCorrectTaxa(mode: GameMode): Promise<number[]> {
  if (!supabaseConfigured) return [];
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return [];
    // RLS scopes this to the current user's rows.
    const { data } = await sb
      .from("species_guesses")
      .select("taxon_id")
      .eq("mode", mode)
      .gt("correct_count", 0);
    return (data ?? []).map((r) => Number(r.taxon_id)).filter(Number.isFinite);
  } catch {
    return [];
  }
}

/** Record one guess against the signed-in player's profile. No-op for guests. */
export async function recordGuess(
  mode: GameMode,
  taxonId: number,
  scientificName: string,
  commonName: string | null,
  correct: boolean,
): Promise<void> {
  if (!supabaseConfigured) return;
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return;
    await sb.rpc("record_guess", {
      p_mode: mode,
      p_taxon_id: taxonId,
      p_scientific_name: scientificName,
      p_common_name: commonName,
      p_correct: correct,
    });
  } catch {
    /* best-effort — tracking must never block or fail a guess */
  }
}
