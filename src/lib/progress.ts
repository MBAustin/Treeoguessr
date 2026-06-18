import { getSupabaseBrowser } from "./supabase/client";
import type { GameMode } from "./inat";

export interface GameResultInput {
  mode: GameMode;
  score: number;
  total: number;
  radius: number;
}

/** Persist a finished game. No-ops for guests / when Supabase isn't configured. */
export async function saveResult(r: GameResultInput): Promise<void> {
  const sb = getSupabaseBrowser();
  if (!sb) return;
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return;
  // user_id defaults to auth.uid() in the DB; RLS enforces ownership.
  await sb.from("game_results").insert({
    mode: r.mode,
    score: r.score,
    total: r.total,
    radius: r.radius,
  });
}

export interface Stats {
  games: number;
  best: number;
  average: number;
}

/** Lifetime stats for the signed-in player, or null if not signed in. */
export async function getStats(): Promise<Stats | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return null;
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb
    .from("game_results")
    .select("score")
    .order("score", { ascending: false });
  if (!data) return null;
  const games = data.length;
  const best = data[0]?.score ?? 0;
  const average = games ? data.reduce((sum, r) => sum + (r.score ?? 0), 0) / games : 0;
  return { games, best, average };
}
