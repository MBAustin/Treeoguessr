"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseEnabled } from "@/lib/supabase/client";
import { useUser } from "@/lib/useUser";
import AuthButton from "@/components/AuthButton";
import { getProfileStats, resetSeenPhotos, resetAllData, type TopSpecies } from "@/lib/profile";
import { getStats } from "@/lib/progress";
import type { GameMode } from "@/lib/inat";

const MODE_LABELS: Record<GameMode, string> = {
  normal: "Normal",
  hard: "Hard",
  botanist: "Taxonomist",
};

export default function ProfilePage() {
  const { user, loading } = useUser();
  const qc = useQueryClient();
  const statsQuery = useQuery({
    queryKey: ["profile-stats", user?.id],
    queryFn: getProfileStats,
    enabled: user != null,
  });
  const scoreQuery = useQuery({
    queryKey: ["game-stats", user?.id],
    queryFn: getStats,
    enabled: user != null,
  });
  const stats = statsQuery.data ?? null;
  const scores = scoreQuery.data ?? null;

  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState<null | "photos" | "all">(null);

  const byMode = stats?.byMode ?? [];
  const totals = byMode.reduce(
    (acc, s) => ({
      correct: acc.correct + s.correct,
      incorrect: acc.incorrect + s.incorrect,
      species: acc.species + s.speciesIdentified,
    }),
    { correct: 0, incorrect: 0, species: 0 },
  );

  async function doReset(kind: "photos" | "all") {
    setBusy(kind);
    try {
      if (kind === "photos") await resetSeenPhotos();
      else await resetAllData();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["profile-stats"] }),
        qc.invalidateQueries({ queryKey: ["game-stats"] }),
      ]);
    } finally {
      setBusy(null);
      setConfirmAll(false);
    }
  }

  return (
    <Shell>
      {!supabaseEnabled ? (
        <p className="text-sm opacity-70">
          Profiles need accounts, which aren&apos;t configured on this deployment.
        </p>
      ) : loading ? (
        <p className="text-sm opacity-70">Loading…</p>
      ) : !user ? (
        <div>
          <p className="mb-3 text-sm opacity-70">
            Sign in to track which species you&apos;ve identified, per mode.
          </p>
          <AuthButton />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Correct" value={totals.correct} accent="text-green-700 dark:text-green-400" />
            <Stat label="Incorrect" value={totals.incorrect} accent="text-red-600 dark:text-red-400" />
            <Stat label="Species identified" value={totals.species} />
          </div>

          {scores && (
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="Best"
                value={scores.best > TOTAL ? `${scores.best} 🔥` : `${scores.best} / ${TOTAL}`}
              />
              <Stat label="Average" value={scores.games ? scores.average.toFixed(1) : "—"} />
              <Stat label="Games" value={scores.games} />
            </div>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">By mode</h2>
            <div className="overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-left opacity-60 dark:border-white/10">
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 text-right font-medium">Correct</th>
                    <th className="px-3 py-2 text-right font-medium">Incorrect</th>
                    <th className="px-3 py-2 text-right font-medium">Species</th>
                  </tr>
                </thead>
                <tbody>
                  {byMode.map((s) => (
                    <tr key={s.mode} className="border-b border-black/5 last:border-0 dark:border-white/5">
                      <td className="px-3 py-2 font-medium">{MODE_LABELS[s.mode]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.correct}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.incorrect}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.speciesIdentified}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {statsQuery.isLoading && <p className="text-xs opacity-50">Refreshing…</p>}
            {!statsQuery.isLoading && totals.correct + totals.incorrect === 0 && (
              <p className="text-sm opacity-70">
                No guesses yet — play a round to start building your profile.
              </p>
            )}
          </section>

          {totals.correct + totals.incorrect > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <SpeciesList
                title="Most identified"
                items={stats?.topCorrect ?? []}
                accent="text-green-700 dark:text-green-400"
              />
              <SpeciesList
                title="Most missed"
                items={stats?.topIncorrect ?? []}
                accent="text-red-600 dark:text-red-400"
              />
            </div>
          )}

          <section className="flex flex-col gap-2 border-t border-black/10 pt-4 dark:border-white/15">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">Manage data</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => doReset("photos")}
                disabled={busy != null}
                className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition hover:border-amber-500 disabled:opacity-50 dark:border-white/20"
              >
                {busy === "photos" ? "Resetting…" : "Reset seen photos"}
              </button>
              {!confirmAll ? (
                <button
                  onClick={() => setConfirmAll(true)}
                  disabled={busy != null}
                  className="rounded-md border border-red-400/60 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:border-red-500 disabled:opacity-50 dark:text-red-400"
                >
                  Reset all data
                </button>
              ) : (
                <span className="flex items-center gap-2 text-sm">
                  <span className="opacity-70">Delete everything?</span>
                  <button
                    onClick={() => doReset("all")}
                    disabled={busy != null}
                    className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                  >
                    {busy === "all" ? "Resetting…" : "Yes, reset all"}
                  </button>
                  <button
                    onClick={() => setConfirmAll(false)}
                    className="rounded-md border border-black/15 px-3 py-1.5 font-medium transition hover:border-black/30 dark:border-white/20"
                  >
                    Cancel
                  </button>
                </span>
              )}
            </div>
            <p className="text-xs opacity-60">
              &ldquo;Reset seen photos&rdquo; lets every photo appear fresh again. &ldquo;Reset all
              data&rdquo; also clears your identified species (and the &ldquo;x of y&rdquo; counter)
              and your scores.
            </p>
          </section>
        </div>
      )}
    </Shell>
  );
}

const TOTAL = 15;

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-black/10 px-3 py-4 text-center dark:border-white/15">
      <div className={`text-2xl font-bold tabular-nums ${accent ?? ""}`}>{value}</div>
      <div className="mt-1 text-xs opacity-60">{label}</div>
    </div>
  );
}

function SpeciesList({
  title,
  items,
  accent,
}: {
  title: string;
  items: TopSpecies[];
  accent: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm opacity-50">Nothing yet.</p>
      ) : (
        <ol className="overflow-hidden rounded-xl border border-black/10 text-sm dark:border-white/15">
          {items.map((s) => (
            <li
              key={s.taxonId}
              className="flex items-center justify-between gap-2 border-b border-black/5 px-3 py-2 last:border-0 dark:border-white/5"
            >
              <span className="truncate">{s.name}</span>
              <span className={`shrink-0 font-semibold tabular-nums ${accent}`}>{s.count}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-green-700 dark:text-green-400">
          👤 Profile
        </h1>
        <Link href="/" className="text-sm underline-offset-2 hover:underline">
          ← Back to game
        </Link>
      </header>
      {children}
    </main>
  );
}
