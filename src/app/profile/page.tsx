"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabaseEnabled } from "@/lib/supabase/client";
import { useUser } from "@/lib/useUser";
import AuthButton from "@/components/AuthButton";
import { getProfileStats } from "@/lib/profile";
import type { GameMode } from "@/lib/inat";

const MODE_LABELS: Record<GameMode, string> = {
  normal: "Normal",
  hard: "Hard",
  botanist: "Taxonomist",
};

export default function ProfilePage() {
  const { user, loading } = useUser();
  const statsQuery = useQuery({
    queryKey: ["profile-stats", user?.id],
    queryFn: getProfileStats,
    enabled: user != null,
  });
  const stats = statsQuery.data ?? null;
  const statsLoading = statsQuery.isLoading;

  const totals = (stats ?? []).reduce(
    (acc, s) => ({
      correct: acc.correct + s.correct,
      incorrect: acc.incorrect + s.incorrect,
      species: acc.species + s.speciesIdentified,
    }),
    { correct: 0, incorrect: 0, species: 0 },
  );

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
                  {(stats ?? []).map((s) => (
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
            {statsLoading && <p className="text-xs opacity-50">Refreshing…</p>}
            {!statsLoading && totals.correct + totals.incorrect === 0 && (
              <p className="text-sm opacity-70">
                No guesses yet — play a round to start building your profile.
              </p>
            )}
          </section>
        </div>
      )}
    </Shell>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border border-black/10 px-3 py-4 text-center dark:border-white/15">
      <div className={`text-2xl font-bold tabular-nums ${accent ?? ""}`}>{value}</div>
      <div className="mt-1 text-xs opacity-60">{label}</div>
    </div>
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
