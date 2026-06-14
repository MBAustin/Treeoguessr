"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { GameMode, Round, RoundOption } from "@/lib/inat";
import AuthButton from "@/components/AuthButton";
import { getStats, saveResult, type Stats } from "@/lib/progress";

type Coords = { lat: number; lng: number };
type GeoStatus = "idle" | "locating" | "ready" | "denied";
type GuessResult = {
  correct: boolean;
  correctTaxonId: number;
  scientificName: string;
  commonName: string | null;
};
type GuessPayload = { token: string; taxonId?: number; text?: string; mode?: GameMode };

const TOTAL_ROUNDS = 15;
const LIFELINES = 3;

const MODES: { id: GameMode; label: string; blurb: string }[] = [
  { id: "normal", label: "Normal", blurb: "Pick the plant from 4 choices." },
  { id: "hard", label: "Hard", blurb: "Type the common name. 3 lifelines reveal choices." },
  {
    id: "botanist",
    label: "Botanist",
    blurb: "Type the scientific name. 3 lifelines reveal choices.",
  },
];

async function fetchRound(
  coords: Coords,
  radius: number,
  mode: GameMode,
  exclude: number[],
): Promise<Round> {
  const params = new URLSearchParams({
    lat: String(coords.lat),
    lng: String(coords.lng),
    radius: String(radius),
    mode,
  });
  if (exclude.length) params.set("exclude", exclude.join(","));
  const res = await fetch(`/api/round?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to load a plant.");
  return data as Round;
}

async function submitGuess(payload: GuessPayload): Promise<GuessResult> {
  const res = await fetch("/api/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to check your guess.");
  return data as GuessResult;
}

async function fetchLifeline(token: string): Promise<RoundOption[]> {
  const res = await fetch("/api/lifeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to use lifeline.");
  return data.options as RoundOption[];
}

export default function Home() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [geoError, setGeoError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [radius, setRadius] = useState(25);
  const [mode, setMode] = useState<GameMode>("normal");

  const [started, setStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [roundSeq, setRoundSeq] = useState(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [lifelinesLeft, setLifelinesLeft] = useState(LIFELINES);

  const [chosen, setChosen] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [revealedOptions, setRevealedOptions] = useState<RoundOption[] | null>(null);
  const [result, setResult] = useState<GuessResult | null>(null);
  const [score, setScore] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  // Species already shown this game, so we never repeat one (and its photo).
  const [seenTaxa, setSeenTaxa] = useState<number[]>([]);

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoStatus("denied");
      setGeoError("This browser doesn't support geolocation.");
      return;
    }
    setGeoStatus("locating");
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("ready");
      },
      (err) => {
        setGeoStatus("denied");
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Allow it in your browser settings, or enter coordinates below."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Your location is unavailable. Enter coordinates below."
              : "Getting your location timed out. Tap “Use my location” to retry, or enter coordinates below.",
        );
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  const roundQuery = useQuery({
    // seenTaxa is deliberately not in the key — it updates when a round is
    // answered, and we don't want that to refetch the round being viewed.
    // roundSeq drives refetches; the queryFn reads the latest seenTaxa.
    queryKey: ["round", coords?.lat, coords?.lng, radius, mode, roundSeq],
    queryFn: () => fetchRound(coords!, radius, mode, seenTaxa),
    enabled: started && !gameOver && coords != null,
  });

  const guess = useMutation({
    mutationFn: submitGuess,
    onSuccess: (data) => {
      setResult(data);
      setScore((s) => s + (data.correct ? 1 : 0));
      setSeenTaxa((prev) =>
        prev.includes(data.correctTaxonId) ? prev : [...prev, data.correctTaxonId],
      );
    },
  });

  const lifeline = useMutation({
    mutationFn: fetchLifeline,
    onSuccess: (options) => {
      setRevealedOptions(options);
      setLifelinesLeft((n) => n - 1);
    },
  });

  function resetRoundState() {
    setChosen(null);
    setTyped("");
    setRevealedOptions(null);
    setResult(null);
    guess.reset();
    lifeline.reset();
  }

  function startGame() {
    setScore(0);
    setStats(null);
    setRoundNumber(1);
    setLifelinesLeft(LIFELINES);
    setSeenTaxa([]);
    setGameOver(false);
    setStarted(true);
    setSettingsOpen(false);
    resetRoundState();
    setRoundSeq((n) => n + 1);
  }

  async function finishGame() {
    setGameOver(true);
    await saveResult({ mode, score, total: TOTAL_ROUNDS, radius });
    setStats(await getStats());
  }

  function nextRound() {
    if (roundNumber >= TOTAL_ROUNDS) {
      void finishGame();
      return;
    }
    setRoundNumber((n) => n + 1);
    resetRoundState();
    setRoundSeq((n) => n + 1);
  }

  function pickOption(taxonId: number, token: string) {
    if (result || guess.isPending) return;
    setChosen(taxonId);
    guess.mutate({ token, taxonId });
  }

  function submitTyped(token: string) {
    if (result || guess.isPending || !typed.trim()) return;
    guess.mutate({ token, text: typed, mode });
  }

  const round = roundQuery.data;

  const hasValidCoords =
    coords != null &&
    Number.isFinite(coords.lat) &&
    Number.isFinite(coords.lng) &&
    coords.lat >= -90 &&
    coords.lat <= 90 &&
    coords.lng >= -180 &&
    coords.lng <= 180;

  const modeLabel = MODES.find((m) => m.id === mode)!.label;
  const options = round?.options ?? revealedOptions;
  const canUseLifeline =
    mode !== "normal" &&
    round != null &&
    !result &&
    revealedOptions == null &&
    lifelinesLeft > 0;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex items-start justify-between gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-green-700 dark:text-green-400">
          🌿 Treeoguessr
        </h1>
        <div className="flex flex-col items-end gap-1">
          <AuthButton />
          {started && !gameOver && (
            <div className="text-right text-sm">
              <span className="font-medium">
                Round {roundNumber}/{TOTAL_ROUNDS}
              </span>
              <span className="ml-2 tabular-nums opacity-70">Score {score}</span>
            </div>
          )}
        </div>
      </header>

      {/* Setup panel — full before playing, collapsed behind a toggle once started */}
      <section className="rounded-xl border border-black/10 dark:border-white/15">
        {started && (
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
          >
            <span>
              ⚙️ Settings · {modeLabel} · {radius} km
            </span>
            <span className="opacity-60">{settingsOpen ? "Hide ▲" : "Show ▼"}</span>
          </button>
        )}

        {(!started || settingsOpen) && (
          <div className={started ? "border-t border-black/10 p-4 dark:border-white/15" : "p-4"}>
            <button
              onClick={locate}
              className="w-full rounded-lg border border-green-600 px-4 py-2 font-medium text-green-700 transition hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30"
            >
              📍 Use my location
            </button>

            <div className="mt-2 min-h-[1.25rem] text-sm">
              {geoStatus === "locating" && (
                <span className="opacity-70">Getting your location…</span>
              )}
              {geoStatus === "ready" && coords && (
                <span className="text-green-700 dark:text-green-400">
                  Located: {coords.lat.toFixed(3)}, {coords.lng.toFixed(3)}
                </span>
              )}
              {geoError && (
                <span className="text-amber-600 dark:text-amber-400">{geoError}</span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs opacity-70">
                Latitude
                <input
                  type="number"
                  step="0.001"
                  inputMode="decimal"
                  placeholder="e.g. 37.871"
                  value={coords && Number.isFinite(coords.lat) ? coords.lat : ""}
                  className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
                  onChange={(e) =>
                    setCoords((c) => ({ lat: Number(e.target.value), lng: c?.lng ?? NaN }))
                  }
                />
              </label>
              <label className="text-xs opacity-70">
                Longitude
                <input
                  type="number"
                  step="0.001"
                  inputMode="decimal"
                  placeholder="e.g. -122.259"
                  value={coords && Number.isFinite(coords.lng) ? coords.lng : ""}
                  className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
                  onChange={(e) =>
                    setCoords((c) => ({ lat: c?.lat ?? NaN, lng: Number(e.target.value) }))
                  }
                />
              </label>
            </div>

            <label className="mt-4 mb-1 block text-sm font-medium">
              Search range: {radius} km
            </label>
            <input
              type="range"
              min={1}
              max={200}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="w-full accent-green-600"
            />

            <div className="mt-4">
              <span className="mb-1 block text-sm font-medium">Difficulty</span>
              <div className="grid grid-cols-3 gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${
                      mode === m.id
                        ? "border-green-600 bg-green-100 dark:bg-green-900/40"
                        : "border-black/15 hover:border-green-500 dark:border-white/20"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs opacity-70">{MODES.find((m) => m.id === mode)!.blurb}</p>
            </div>

            <button
              onClick={startGame}
              disabled={!hasValidCoords}
              className="mt-4 w-full rounded-lg bg-green-600 px-4 py-2 font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {started ? "Restart game" : "Start playing"}
            </button>
          </div>
        )}
      </section>

      {/* Game over summary */}
      {started && gameOver && (
        <section className="rounded-xl border border-black/10 p-6 text-center dark:border-white/15">
          <h2 className="text-xl font-bold">Game over 🌱</h2>
          <p className="mt-2 text-3xl font-bold tabular-nums text-green-700 dark:text-green-400">
            {score}/{TOTAL_ROUNDS}
          </p>
          <p className="mt-1 text-sm opacity-70">
            {modeLabel} mode · {radius} km
          </p>
          {stats && (
            <p className="mt-3 text-sm">
              Best <span className="font-semibold">{stats.best}/{TOTAL_ROUNDS}</span> ·{" "}
              {stats.games} {stats.games === 1 ? "game" : "games"} played
            </p>
          )}
          <button
            onClick={startGame}
            disabled={!hasValidCoords}
            className="mt-5 w-full rounded-lg bg-green-600 px-4 py-2 font-semibold text-white transition hover:bg-green-700 disabled:opacity-40"
          >
            Play again
          </button>
        </section>
      )}

      {/* Active round */}
      {started && !gameOver && (
        <section>
          {roundQuery.isLoading && (
            <p className="text-center text-sm opacity-70">Finding a plant near you…</p>
          )}
          {roundQuery.isError && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {(roundQuery.error as Error).message}
              <button onClick={() => roundQuery.refetch()} className="ml-2 underline">
                Retry
              </button>
            </div>
          )}

          {round && (
            <div className="flex flex-col gap-4">
              <figure className="overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={round.photo.url}
                  alt="A plant observed near you — can you identify it?"
                  className="h-72 w-full bg-black/5 object-cover dark:bg-white/5"
                />
                <figcaption className="px-3 py-2 text-xs opacity-60">
                  Photo: {round.photo.attribution || "iNaturalist contributor"}
                  {round.photo.licenseCode ? ` (${round.photo.licenseCode})` : ""} ·{" "}
                  <a
                    href={round.photo.observationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    View on iNaturalist
                  </a>
                </figcaption>
              </figure>

              {/* Lifelines bar (typed modes only) */}
              {mode !== "normal" && (
                <div className="flex items-center justify-between text-sm">
                  <span className="opacity-70">
                    Lifelines: {"💡".repeat(lifelinesLeft) || "—"}
                  </span>
                  {canUseLifeline && (
                    <button
                      onClick={() => lifeline.mutate(round.token)}
                      disabled={lifeline.isPending}
                      className="rounded-md border border-green-600 px-3 py-1 font-medium text-green-700 transition hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-950/30"
                    >
                      {lifeline.isPending ? "Revealing…" : "Use a lifeline"}
                    </button>
                  )}
                </div>
              )}

              {/* Answer input: multiple choice (normal, or after lifeline) vs typed */}
              {options ? (
                <div className="grid gap-2">
                  {options.map((opt) => {
                    const isCorrect = result?.correctTaxonId === opt.taxonId;
                    const isChosenWrong =
                      result != null && chosen === opt.taxonId && !result.correct;
                    let style =
                      "border-black/15 hover:border-green-500 hover:bg-green-50 dark:border-white/20 dark:hover:bg-green-950/30";
                    if (result) {
                      if (isCorrect)
                        style = "border-green-600 bg-green-100 dark:bg-green-900/40";
                      else if (isChosenWrong)
                        style = "border-red-500 bg-red-100 dark:bg-red-900/40";
                      else style = "border-black/10 opacity-60 dark:border-white/10";
                    }
                    return (
                      <button
                        key={opt.taxonId}
                        onClick={() => pickOption(opt.taxonId, round.token)}
                        disabled={result != null || guess.isPending}
                        className={`rounded-lg border px-4 py-3 text-left transition ${style}`}
                      >
                        <span className="block font-medium">
                          {opt.commonName ?? opt.scientificName}
                        </span>
                        {opt.commonName && (
                          <span className="block text-xs italic opacity-60">
                            {opt.scientificName}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={typed}
                    disabled={result != null}
                    placeholder={
                      mode === "botanist" ? "Scientific name…" : "Common name…"
                    }
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitTyped(round.token)}
                    className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
                  />
                  <button
                    onClick={() => submitTyped(round.token)}
                    disabled={result != null || guess.isPending || !typed.trim()}
                    className="rounded-lg bg-green-600 px-4 py-2 font-semibold text-white transition hover:bg-green-700 disabled:opacity-40"
                  >
                    Guess
                  </button>
                </div>
              )}

              {result && (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <span className="font-semibold">
                      {result.correct ? "✅ Correct!" : "❌ Not quite."}
                    </span>
                    <div className="opacity-70">
                      {result.commonName ? `${result.commonName} · ` : ""}
                      <span className="italic">{result.scientificName}</span>
                    </div>
                  </div>
                  <button
                    onClick={nextRound}
                    className="shrink-0 rounded-lg bg-green-600 px-4 py-2 font-semibold text-white transition hover:bg-green-700"
                  >
                    {roundNumber >= TOTAL_ROUNDS ? "See results" : "Next plant →"}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <footer className="mt-auto pt-4 text-center text-xs opacity-50">
        Plant data &amp; photos from{" "}
        <a href="https://www.inaturalist.org" className="underline">
          iNaturalist
        </a>{" "}
        contributors.
      </footer>
    </main>
  );
}
