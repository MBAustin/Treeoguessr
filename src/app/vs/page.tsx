"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseEnabled, getSupabaseBrowser } from "@/lib/supabase/client";
import AuthButton from "@/components/AuthButton";
import {
  getMyProfile,
  setUsername,
  searchProfiles,
  usernameError,
  type Profile,
} from "@/lib/profiles";
import {
  loadFriends,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriendship,
  type FriendView,
} from "@/lib/friends";
import {
  loadMatches,
  createChallenge,
  acceptMatch,
  declineMatch,
  type MatchView,
} from "@/lib/matches";
import type { GameMode } from "@/lib/inat";

const VS_RADIUS_KM = 25;
const MODES: { id: GameMode; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "hard", label: "Hard" },
  { id: "botanist", label: "Taxonomist" },
];

type Coords = { lat: number; lng: number };

function getLocation(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("This browser doesn't support geolocation."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("Couldn't get your location. Allow location access and try again.")),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}

export default function VsHub() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<FriendView[]>([]);
  const [incoming, setIncoming] = useState<FriendView[]>([]);
  const [outgoing, setOutgoing] = useState<FriendView[]>([]);
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const me = await getMyProfile();
    setProfile(me);
    if (me) {
      const [f, m] = await Promise.all([loadFriends(), loadMatches()]);
      setFriends(f.friends);
      setIncoming(f.incoming);
      setOutgoing(f.outgoing);
      setMatches(m);
    }
  }, []);

  useEffect(() => {
    if (!supabaseEnabled) {
      setReady(true);
      return;
    }
    const sb = getSupabaseBrowser()!;
    sb.auth.getUser().then(async ({ data }) => {
      setSignedIn(Boolean(data.user));
      if (data.user) await reload();
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      setSignedIn(Boolean(session?.user));
      if (session?.user) void reload();
      else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [reload]);

  // Poll for incoming requests / opponents finishing while the page is open.
  useEffect(() => {
    if (!signedIn || !profile) return;
    const id = setInterval(reload, 15000);
    return () => clearInterval(id);
  }, [signedIn, profile, reload]);

  async function run(key: string, fn: () => Promise<string | null | void>, ok?: string) {
    setBusy(key);
    setNotice(null);
    try {
      const err = await fn();
      if (typeof err === "string" && err) setNotice(err);
      else if (ok) setNotice(ok);
      await reload();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!ready) {
    return <Shell><p className="text-sm opacity-70">Loading…</p></Shell>;
  }

  if (!supabaseEnabled) {
    return (
      <Shell>
        <p className="text-sm opacity-70">
          VS mode needs accounts, which aren&apos;t configured on this deployment.
        </p>
      </Shell>
    );
  }

  if (!signedIn) {
    return (
      <Shell>
        <p className="mb-3 text-sm opacity-70">Sign in to play against friends.</p>
        <AuthButton />
      </Shell>
    );
  }

  if (!profile) {
    return (
      <Shell>
        <UsernamePicker
          busy={busy === "username"}
          notice={notice}
          onSave={(name) => run("username", () => setUsername(name))}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col gap-6">
        <p className="text-sm">
          You are <span className="font-semibold">@{profile.username}</span>{" "}
          <UsernameEditor
            current={profile.username}
            busy={busy === "username"}
            onSave={(name) => run("username", () => setUsername(name))}
          />
        </p>

        {notice && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            {notice}
          </p>
        )}

        <FindFriends
          busy={busy}
          existingIds={[...friends, ...incoming, ...outgoing].map((f) => f.userId)}
          onAdd={(userId) => run(`add-${userId}`, () => sendFriendRequest(userId), "Request sent.")}
        />

        {incoming.length > 0 && (
          <Section title="Friend requests">
            {incoming.map((f) => (
              <Row key={f.friendshipId} label={`@${f.username}`}>
                <Btn
                  busy={busy === `acc-${f.friendshipId}`}
                  onClick={() => run(`acc-${f.friendshipId}`, () => acceptFriendRequest(f.friendshipId))}
                >
                  Accept
                </Btn>
                <Btn
                  variant="ghost"
                  busy={busy === `rm-${f.friendshipId}`}
                  onClick={() => run(`rm-${f.friendshipId}`, () => removeFriendship(f.friendshipId))}
                >
                  Decline
                </Btn>
              </Row>
            ))}
          </Section>
        )}

        <Section title={`Friends (${friends.length})`}>
          {friends.length === 0 && (
            <p className="text-sm opacity-60">No friends yet — search above to add some.</p>
          )}
          {friends.map((f) => (
            <FriendRow
              key={f.friendshipId}
              friend={f}
              busy={busy}
              onChallenge={(mode) =>
                run(`ch-${f.userId}`, async () => {
                  const loc = await getLocation();
                  const res = await createChallenge(f.userId, mode, { ...loc, radius: VS_RADIUS_KM });
                  return res.error ?? null;
                }, "Challenge sent!")
              }
              onUnfriend={() => run(`rm-${f.friendshipId}`, () => removeFriendship(f.friendshipId))}
            />
          ))}
        </Section>

        <Challenges
          matches={matches}
          busy={busy}
          onAccept={(id) =>
            run(`mac-${id}`, async () => {
              const loc = await getLocation();
              return acceptMatch(id, { ...loc, radius: VS_RADIUS_KM });
            }, "Match ready — it's your turn to play!")
          }
          onDecline={(id) => run(`mdec-${id}`, () => declineMatch(id))}
        />
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-green-700 dark:text-green-400">
          ⚔️ VS mode
        </h1>
        <Link href="/" className="text-sm underline-offset-2 hover:underline">
          ← Back to game
        </Link>
      </header>
      {children}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-black/10 px-3 py-2 dark:border-white/15">
      <span className="truncate font-medium">{label}</span>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  busy,
  variant = "solid",
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  variant?: "solid" | "ghost";
}) {
  const base = "rounded-md px-3 py-1 text-sm font-medium transition disabled:opacity-50";
  const style =
    variant === "solid"
      ? "bg-green-600 text-white hover:bg-green-700"
      : "border border-black/15 hover:border-red-400 dark:border-white/20";
  return (
    <button onClick={onClick} disabled={busy} className={`${base} ${style}`}>
      {busy ? "…" : children}
    </button>
  );
}

function UsernamePicker({
  busy,
  notice,
  onSave,
}: {
  busy: boolean;
  notice: string | null;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const err = name ? usernameError(name) : null;
  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">Pick a username</h2>
      <p className="mb-3 text-sm opacity-70">
        This is how friends find and challenge you. 3–20 letters, numbers or underscores.
      </p>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. fern_fan"
          className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
        />
        <button
          onClick={() => onSave(name)}
          disabled={busy || !name || !!err}
          className="rounded-lg bg-green-600 px-4 py-2 font-semibold text-white transition hover:bg-green-700 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {(err || notice) && (
        <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">{err ?? notice}</p>
      )}
    </div>
  );
}

function UsernameEditor({
  current,
  busy,
  onSave,
}: {
  current: string;
  busy: boolean;
  onSave: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(current);
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-xs underline opacity-60">
        edit
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-32 rounded-md border border-black/15 bg-transparent px-2 py-0.5 text-sm dark:border-white/20"
      />
      <button
        onClick={() => {
          onSave(name);
          setEditing(false);
        }}
        disabled={busy}
        className="text-xs font-medium text-green-700 dark:text-green-400"
      >
        save
      </button>
      <button onClick={() => setEditing(false)} className="text-xs opacity-60">
        cancel
      </button>
    </span>
  );
}

function FindFriends({
  busy,
  existingIds,
  onAdd,
}: {
  busy: string | null;
  existingIds: string[];
  onAdd: (userId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const known = new Set(existingIds);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchProfiles(query);
      if (active) {
        setResults(r);
        setSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <Section title="Find players">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by username…"
        className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
      />
      {searching && <p className="text-sm opacity-60">Searching…</p>}
      {results.map((p) => (
        <Row key={p.user_id} label={`@${p.username}`}>
          {known.has(p.user_id) ? (
            <span className="text-xs opacity-60">already connected</span>
          ) : (
            <Btn busy={busy === `add-${p.user_id}`} onClick={() => onAdd(p.user_id)}>
              Add friend
            </Btn>
          )}
        </Row>
      ))}
      {query.trim().length >= 2 && !searching && results.length === 0 && (
        <p className="text-sm opacity-60">No players found.</p>
      )}
    </Section>
  );
}

function FriendRow({
  friend,
  busy,
  onChallenge,
  onUnfriend,
}: {
  friend: FriendView;
  busy: string | null;
  onChallenge: (mode: GameMode) => void;
  onUnfriend: () => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="rounded-lg border border-black/10 px-3 py-2 dark:border-white/15">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">@{friend.username}</span>
        <div className="flex shrink-0 items-center gap-2">
          <Btn onClick={() => setPicking((p) => !p)}>Challenge</Btn>
          <Btn variant="ghost" busy={busy === `rm-${friend.friendshipId}`} onClick={onUnfriend}>
            Remove
          </Btn>
        </div>
      </div>
      {picking && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-black/10 pt-2 dark:border-white/15">
          <span className="text-sm opacity-70">Difficulty:</span>
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onChallenge(m.id);
                setPicking(false);
              }}
              disabled={busy === `ch-${friend.userId}`}
              className="rounded-md border border-green-600 px-3 py-1 text-sm font-medium text-green-700 transition hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-950/30"
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Challenges({
  matches,
  busy,
  onAccept,
  onDecline,
}: {
  matches: MatchView[];
  busy: string | null;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}) {
  const incoming = matches.filter((m) => m.status === "pending" && m.role === "opponent");
  const yourTurn = matches.filter((m) => m.status === "active" && !m.iSubmitted);
  const waiting = matches.filter(
    (m) =>
      (m.status === "pending" && m.role === "challenger") ||
      (m.status === "active" && m.iSubmitted),
  );
  const done = matches.filter((m) => m.status === "complete");

  return (
    <>
      {incoming.length > 0 && (
        <Section title="Incoming challenges">
          {incoming.map((m) => (
            <Row key={m.id} label={`@${m.opponentName} · ${m.mode}`}>
              <Btn busy={busy === `mac-${m.id}`} onClick={() => onAccept(m.id)}>
                Accept &amp; play
              </Btn>
              <Btn variant="ghost" busy={busy === `mdec-${m.id}`} onClick={() => onDecline(m.id)}>
                Decline
              </Btn>
            </Row>
          ))}
        </Section>
      )}

      {yourTurn.length > 0 && (
        <Section title="Your turn">
          {yourTurn.map((m) => (
            <Row key={m.id} label={`vs @${m.opponentName} · ${m.mode}`}>
              <Link
                href={`/vs/${m.id}`}
                className="rounded-md bg-green-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-green-700"
              >
                Play
              </Link>
            </Row>
          ))}
        </Section>
      )}

      {waiting.length > 0 && (
        <Section title="Waiting on them">
          {waiting.map((m) => (
            <Row
              key={m.id}
              label={`vs @${m.opponentName} · ${m.mode}`}
            >
              <span className="text-xs opacity-60">
                {m.status === "pending" ? "awaiting accept" : "they're still playing"}
              </span>
            </Row>
          ))}
        </Section>
      )}

      {done.length > 0 && (
        <Section title="Completed">
          {done.map((m) => {
            const outcome =
              m.myScore == null || m.theirScore == null
                ? ""
                : m.myScore > m.theirScore
                  ? "won"
                  : m.myScore < m.theirScore
                    ? "lost"
                    : "tied";
            return (
              <Link
                key={m.id}
                href={`/vs/${m.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-black/10 px-3 py-2 transition hover:border-green-500 dark:border-white/15"
              >
                <span className="truncate font-medium">vs @{m.opponentName}</span>
                <span className="shrink-0 text-sm tabular-nums opacity-70">
                  {m.myScore}–{m.theirScore} {outcome && `· ${outcome}`}
                </span>
              </Link>
            );
          })}
        </Section>
      )}
    </>
  );
}
