"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import RoundCard, { type Guess } from "@/components/RoundCard";
import { currentUserId } from "@/lib/profiles";
import { getMatch, submitMatch, type Match, type SubmitGuess } from "@/lib/matches";

const LIFELINES = 3;

interface Loaded {
  match: Match;
  challengerName: string;
  opponentName: string;
  uid: string;
}

export default function MatchPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = params.matchId;

  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Play state
  const [idx, setIdx] = useState(0);
  const [guesses, setGuesses] = useState<SubmitGuess[]>([]);
  const [lifelinesLeft, setLifelinesLeft] = useState(LIFELINES);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [res, uid] = await Promise.all([getMatch(matchId), currentUserId()]);
    if (!uid) {
      setLoadError("Sign in to view this match.");
    } else if (!res) {
      setLoadError("This match couldn't be found.");
    } else if (res.match.challenger !== uid && res.match.opponent !== uid) {
      setLoadError("This match isn't yours.");
    } else {
      setData({ ...res, uid });
      setLoadError(null);
    }
    setLoading(false);
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Shell><p className="text-sm opacity-70">Loading match…</p></Shell>;
  if (loadError || !data) {
    return (
      <Shell>
        <p className="text-sm text-amber-600 dark:text-amber-400">{loadError}</p>
      </Shell>
    );
  }

  const { match, challengerName, opponentName, uid } = data;
  const isChallenger = match.challenger === uid;
  const myName = isChallenger ? challengerName : opponentName;
  const theirName = isChallenger ? opponentName : challengerName;
  const myScore = isChallenger ? match.challenger_score : match.opponent_score;
  const theirScore = isChallenger ? match.opponent_score : match.challenger_score;

  // --- Completed: results screen --------------------------------------------
  if (match.status === "complete") {
    return (
      <Shell>
        <Results
          challengerName={challengerName}
          opponentName={opponentName}
          challengerScore={match.challenger_score ?? 0}
          opponentScore={match.opponent_score ?? 0}
        />
      </Shell>
    );
  }

  if (match.status === "declined") {
    return <Shell><p className="text-sm opacity-70">This challenge was declined.</p></Shell>;
  }

  if (match.status === "pending" || !match.rounds) {
    return (
      <Shell>
        <p className="text-sm opacity-70">
          This challenge hasn&apos;t started yet. It begins once {theirName} accepts.
        </p>
      </Shell>
    );
  }

  // --- Active but already played: waiting for the opponent -------------------
  if (myScore != null) {
    return (
      <Shell>
        <div className="rounded-xl border border-black/10 p-6 text-center dark:border-white/15">
          <h2 className="text-lg font-semibold">You scored {myScore}/{match.rounds.length} 🌿</h2>
          <p className="mt-2 text-sm opacity-70">
            Waiting for @{theirName} to finish. Check back soon for the result.
          </p>
          <Link href="/vs" className="mt-4 inline-block text-sm text-green-700 underline dark:text-green-400">
            ← Back to VS
          </Link>
        </div>
      </Shell>
    );
  }

  // --- Active and my turn: play the frozen rounds ---------------------------
  const rounds = match.rounds;
  const round = rounds[idx];
  const isLast = idx + 1 >= rounds.length;
  // Which player's area this plant came from.
  const fromMine = (round.owner === "challenger") === isChallenger;

  async function finish(allGuesses: SubmitGuess[]) {
    setSubmitting(true);
    setSubmitError(null);
    const res = await submitMatch(matchId, allGuesses);
    if (res.error) {
      setSubmitError(res.error);
      setSubmitting(false);
      return;
    }
    await load(); // re-render into waiting or results
    setSubmitting(false);
  }

  function recordGuess(guess: Guess) {
    setGuesses((prev) => {
      const next = [...prev];
      next[idx] = guess;
      return next;
    });
  }

  function next() {
    if (isLast) {
      // guesses[idx] was just set in recordGuess; build the final array defensively.
      const finalGuesses = [...guesses];
      void finish(finalGuesses);
      return;
    }
    setIdx((i) => i + 1);
  }

  return (
    <Shell>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-medium">
          vs @{theirName} · Plant {idx + 1}/{rounds.length}
        </span>
        <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs opacity-70 dark:border-white/15">
          {fromMine ? "🌍 your area" : `📍 @${theirName}'s area`}
        </span>
      </div>

      {submitError && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{submitError}</p>
      )}

      <RoundCard
        key={idx}
        round={round}
        mode={match.mode}
        lifelinesLeft={lifelinesLeft}
        onUseLifeline={() => setLifelinesLeft((n) => n - 1)}
        onAnswered={(_result, guess) => recordGuess(guess)}
        nextButton={
          <button
            onClick={next}
            disabled={submitting}
            className="shrink-0 rounded-lg bg-green-600 px-4 py-2 font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : isLast ? "Finish" : "Next plant →"}
          </button>
        }
      />
      <p className="mt-2 text-xs opacity-50">
        Playing as @{myName}. Both of you see these same {rounds.length} plants.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-8">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-green-700 dark:text-green-400">
          ⚔️ VS match
        </h1>
        <Link href="/vs" className="text-sm underline-offset-2 hover:underline">
          ← VS hub
        </Link>
      </header>
      {children}
    </main>
  );
}

function Results({
  challengerName,
  opponentName,
  challengerScore,
  opponentScore,
}: {
  challengerName: string;
  opponentName: string;
  challengerScore: number;
  opponentScore: number;
}) {
  const tie = challengerScore === opponentScore;
  const winner = challengerScore > opponentScore ? challengerName : opponentName;
  const loser = challengerScore > opponentScore ? opponentName : challengerName;

  return (
    <div className="rounded-xl border border-black/10 p-6 text-center dark:border-white/15">
      <h2 className="text-xl font-bold">Match results 🌱</h2>
      <div className="mt-4 flex items-center justify-center gap-6">
        <div>
          <div className="text-sm opacity-70">@{challengerName}</div>
          <div className="text-3xl font-bold tabular-nums text-green-700 dark:text-green-400">
            {challengerScore}
          </div>
        </div>
        <div className="text-2xl opacity-40">vs</div>
        <div>
          <div className="text-sm opacity-70">@{opponentName}</div>
          <div className="text-3xl font-bold tabular-nums text-green-700 dark:text-green-400">
            {opponentScore}
          </div>
        </div>
      </div>

      <p className="mt-5 text-lg font-medium">
        {tie ? (
          <>You&apos;re equally at one with nature. 🌳</>
        ) : (
          <>
            <span className="font-bold">@{winner}</span> is more one with nature than{" "}
            <span className="font-bold">@{loser}</span>.
          </>
        )}
      </p>

      <Link
        href="/vs"
        className="mt-5 inline-block rounded-lg bg-green-600 px-4 py-2 font-semibold text-white transition hover:bg-green-700"
      >
        Back to VS
      </Link>
    </div>
  );
}
