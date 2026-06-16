import { getSupabaseBrowser } from "./supabase/client";
import { currentUserId, profileMap } from "./profiles";
import type { GameMode, RoundOption, RoundPhoto } from "./inat";

export interface MatchLocation {
  lat: number;
  lng: number;
  radius: number;
}

/** A frozen round as stored/served to the client — no answer, just what's needed to play. */
export interface ClientRound {
  token: string;
  photos: RoundPhoto[];
  options: RoundOption[] | null;
  owner: "challenger" | "opponent";
}

export type MatchStatus = "pending" | "active" | "complete" | "declined";

export interface Match {
  id: string;
  challenger: string;
  opponent: string;
  mode: GameMode;
  status: MatchStatus;
  challenger_loc: MatchLocation;
  opponent_loc: MatchLocation | null;
  rounds: ClientRound[] | null;
  challenger_score: number | null;
  opponent_score: number | null;
  created_at: string;
  updated_at: string;
}

/** A match from the current user's point of view, with usernames resolved. */
export interface MatchView {
  id: string;
  mode: GameMode;
  status: MatchStatus;
  role: "challenger" | "opponent";
  opponentName: string;
  myScore: number | null;
  theirScore: number | null;
  iSubmitted: boolean;
  createdAt: string;
}

function toView(m: Match, uid: string, names: Map<string, string>): MatchView {
  const isChallenger = m.challenger === uid;
  const otherId = isChallenger ? m.opponent : m.challenger;
  return {
    id: m.id,
    mode: m.mode,
    status: m.status,
    role: isChallenger ? "challenger" : "opponent",
    opponentName: names.get(otherId) ?? "(unknown)",
    myScore: isChallenger ? m.challenger_score : m.opponent_score,
    theirScore: isChallenger ? m.opponent_score : m.challenger_score,
    iSubmitted: (isChallenger ? m.challenger_score : m.opponent_score) != null,
    createdAt: m.created_at,
  };
}

/** All matches involving the current user, newest first, with usernames. */
export async function loadMatches(): Promise<MatchView[]> {
  const sb = getSupabaseBrowser();
  if (!sb) return [];
  const uid = await currentUserId();
  if (!uid) return [];

  const { data } = await sb
    .from("matches")
    .select("*")
    .or(`challenger.eq.${uid},opponent.eq.${uid}`)
    .order("created_at", { ascending: false });
  const rows = (data as Match[]) ?? [];

  const names = await profileMap(rows.map((m) => (m.challenger === uid ? m.opponent : m.challenger)));
  return rows.map((m) => toView(m, uid, names));
}

/** Load a single match plus both usernames (for the play / results page). */
export async function getMatch(
  matchId: string,
): Promise<{ match: Match; challengerName: string; opponentName: string } | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return null;
  const { data } = await sb.from("matches").select("*").eq("id", matchId).maybeSingle();
  if (!data) return null;
  const match = data as Match;
  // Tolerate matches frozen before the multi-photo change (single `photo`).
  for (const r of match.rounds ?? []) {
    const legacy = r as ClientRound & { photo?: RoundPhoto };
    if (!legacy.photos && legacy.photo) legacy.photos = [legacy.photo];
  }
  const names = await profileMap([match.challenger, match.opponent]);
  return {
    match,
    challengerName: names.get(match.challenger) ?? "(unknown)",
    opponentName: names.get(match.opponent) ?? "(unknown)",
  };
}

/** Create a challenge against a friend. Returns the new match id or an error message. */
export async function createChallenge(
  opponentUserId: string,
  mode: GameMode,
  location: MatchLocation,
): Promise<{ id?: string; error?: string }> {
  const sb = getSupabaseBrowser();
  if (!sb) return { error: "Sign-in is not available." };
  const uid = await currentUserId();
  if (!uid) return { error: "You need to sign in first." };

  const { data, error } = await sb
    .from("matches")
    .insert({
      challenger: uid,
      opponent: opponentUserId,
      mode,
      status: "pending",
      challenger_loc: location,
    })
    .select("id")
    .single();
  if (error) return { error: "Couldn't create the challenge." };
  return { id: (data as { id: string }).id };
}

/** Opponent declines a pending challenge. */
export async function declineMatch(matchId: string): Promise<string | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return "Sign-in is not available.";
  const { error } = await sb
    .from("matches")
    .update({ status: "declined", updated_at: new Date().toISOString() })
    .eq("id", matchId);
  return error ? "Couldn't decline the challenge." : null;
}

/** Opponent accepts: freezes the rounds server-side. Returns an error message or null. */
export async function acceptMatch(matchId: string, location: MatchLocation): Promise<string | null> {
  const res = await fetch("/api/vs/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId, location }),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? null : (data.error ?? "Couldn't accept the challenge.");
}

export interface SubmitGuess {
  taxonId?: number;
  text?: string;
}

/** Submit the player's guesses; scoring happens server-side. */
export async function submitMatch(
  matchId: string,
  guesses: SubmitGuess[],
): Promise<{ score?: number; total?: number; error?: string }> {
  const res = await fetch("/api/vs/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId, guesses }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error ?? "Couldn't submit your result." };
  return { score: data.score, total: data.total };
}
