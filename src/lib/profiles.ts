import { getSupabaseBrowser } from "./supabase/client";

export interface Profile {
  user_id: string;
  username: string;
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/** Validate a username: 3–20 chars, letters/digits/underscore. */
export function usernameError(name: string): string | null {
  if (!USERNAME_RE.test(name)) {
    return "3–20 characters, letters, numbers and underscores only.";
  }
  return null;
}

/** The signed-in user's id, or null if not signed in / Supabase off. */
export async function currentUserId(): Promise<string | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return null;
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user?.id ?? null;
}

/** The signed-in user's profile, or null if they haven't picked a username. */
export async function getMyProfile(): Promise<Profile | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return null;
  const uid = await currentUserId();
  if (!uid) return null;
  const { data } = await sb
    .from("profiles")
    .select("user_id, username")
    .eq("user_id", uid)
    .maybeSingle();
  return (data as Profile) ?? null;
}

/** Create or change the signed-in user's username. Returns an error message or null. */
export async function setUsername(username: string): Promise<string | null> {
  const err = usernameError(username);
  if (err) return err;
  const sb = getSupabaseBrowser();
  if (!sb) return "Sign-in is not available.";
  const uid = await currentUserId();
  if (!uid) return "You need to sign in first.";

  const { error } = await sb
    .from("profiles")
    .upsert({ user_id: uid, username }, { onConflict: "user_id" });
  if (error) {
    if (error.code === "23505") return "That username is already taken.";
    return "Couldn't save your username. Try again.";
  }
  return null;
}

/** Search profiles by username (case-insensitive, excludes yourself). */
export async function searchProfiles(query: string): Promise<Profile[]> {
  const sb = getSupabaseBrowser();
  if (!sb || query.trim().length < 2) return [];
  const uid = await currentUserId();
  const { data } = await sb
    .from("profiles")
    .select("user_id, username")
    .ilike("username", `%${query.trim()}%`)
    .limit(10);
  return ((data as Profile[]) ?? []).filter((p) => p.user_id !== uid);
}

/** Fetch usernames for a set of user ids, as a id→username map. */
export async function profileMap(userIds: string[]): Promise<Map<string, string>> {
  const sb = getSupabaseBrowser();
  const map = new Map<string, string>();
  const ids = [...new Set(userIds)];
  if (!sb || ids.length === 0) return map;
  const { data } = await sb.from("profiles").select("user_id, username").in("user_id", ids);
  for (const p of (data as Profile[]) ?? []) map.set(p.user_id, p.username);
  return map;
}
