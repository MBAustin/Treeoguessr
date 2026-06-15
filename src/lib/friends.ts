import { getSupabaseBrowser } from "./supabase/client";
import { currentUserId, profileMap } from "./profiles";

export interface Friendship {
  id: string;
  requester: string;
  addressee: string;
  status: "pending" | "accepted";
}

export interface FriendView {
  friendshipId: string;
  userId: string;
  username: string;
}

interface FriendBuckets {
  friends: FriendView[]; // accepted
  incoming: FriendView[]; // pending, you are the addressee
  outgoing: FriendView[]; // pending, you sent it
}

/** Load every friendship touching the current user, bucketed and with usernames. */
export async function loadFriends(): Promise<FriendBuckets> {
  const empty: FriendBuckets = { friends: [], incoming: [], outgoing: [] };
  const sb = getSupabaseBrowser();
  if (!sb) return empty;
  const uid = await currentUserId();
  if (!uid) return empty;

  const { data } = await sb
    .from("friendships")
    .select("id, requester, addressee, status")
    .or(`requester.eq.${uid},addressee.eq.${uid}`);
  const rows = (data as Friendship[]) ?? [];

  const otherIds = rows.map((r) => (r.requester === uid ? r.addressee : r.requester));
  const names = await profileMap(otherIds);
  const view = (r: Friendship): FriendView => {
    const other = r.requester === uid ? r.addressee : r.requester;
    return { friendshipId: r.id, userId: other, username: names.get(other) ?? "(unknown)" };
  };

  const buckets: FriendBuckets = { friends: [], incoming: [], outgoing: [] };
  for (const r of rows) {
    if (r.status === "accepted") buckets.friends.push(view(r));
    else if (r.addressee === uid) buckets.incoming.push(view(r));
    else buckets.outgoing.push(view(r));
  }
  return buckets;
}

/** Send a friend request to another user. Returns an error message or null. */
export async function sendFriendRequest(addresseeUserId: string): Promise<string | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return "Sign-in is not available.";
  const uid = await currentUserId();
  if (!uid) return "You need to sign in first.";
  if (uid === addresseeUserId) return "You can't friend yourself.";

  const { error } = await sb
    .from("friendships")
    .insert({ requester: uid, addressee: addresseeUserId, status: "pending" });
  if (error) {
    if (error.code === "23505") return "You're already connected with that player.";
    return "Couldn't send the request. Try again.";
  }
  return null;
}

/** Accept a pending request where you are the addressee. */
export async function acceptFriendRequest(friendshipId: string): Promise<string | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return "Sign-in is not available.";
  const { error } = await sb
    .from("friendships")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("id", friendshipId);
  return error ? "Couldn't accept the request." : null;
}

/** Decline an incoming request or remove an existing friendship. */
export async function removeFriendship(friendshipId: string): Promise<string | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return "Sign-in is not available.";
  const { error } = await sb.from("friendships").delete().eq("id", friendshipId);
  return error ? "Couldn't update that friendship." : null;
}
