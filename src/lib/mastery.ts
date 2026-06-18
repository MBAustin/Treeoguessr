import { createClient } from "./supabase/server";
import type { GameMode } from "./inat";

// Tracking is Supabase-backed and signed-in only; everything here no-ops (and
// never throws) for guests or when Supabase isn't configured, so guest play and
// the guess/round routes are unaffected.
const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// How many recently-seen species to soft-de-prioritize for cross-game variety.
const RECENT_TAXA_LIMIT = 200;

/** The player's most-recently-seen species in `mode` (newest first), used to nudge
 *  round selection toward fresher species. Empty for guests. */
export async function getRecentTaxa(mode: GameMode): Promise<number[]> {
  if (!supabaseConfigured) return [];
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return [];
    const { data } = await sb
      .from("species_guesses")
      .select("taxon_id")
      .eq("mode", mode)
      .order("updated_at", { ascending: false })
      .limit(RECENT_TAXA_LIMIT);
    return (data ?? []).map((r) => Number(r.taxon_id)).filter(Number.isFinite);
  } catch {
    return [];
  }
}

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

/**
 * Of `photoIds`, which the signed-in player has already been shown. Used to avoid
 * repeating photos across games. Empty set for guests (no cross-game memory).
 */
export async function getSeenPhotos(photoIds: number[]): Promise<Set<number>> {
  if (!supabaseConfigured || photoIds.length === 0) return new Set();
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return new Set();
    const { data } = await sb.from("seen_photos").select("photo_id").in("photo_id", photoIds);
    return new Set((data ?? []).map((r) => Number(r.photo_id)));
  } catch {
    return new Set();
  }
}

/** Record photos just shown to the player. No-op for guests; best-effort. */
export async function recordSeenPhotos(photoIds: number[]): Promise<void> {
  if (!supabaseConfigured || photoIds.length === 0) return;
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return;
    const rows = photoIds.map((id) => ({ user_id: user.id, photo_id: id }));
    await sb
      .from("seen_photos")
      .upsert(rows, { onConflict: "user_id,photo_id", ignoreDuplicates: true });
  } catch {
    /* best-effort — never block a round on tracking */
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
