"use client";

import { useState, type ReactNode } from "react";
import type { GameMode, RoundOption, RoundPhoto } from "@/lib/inat";

export type GuessResult = {
  correct: boolean;
  correctTaxonId: number;
  scientificName: string;
  commonName: string | null;
};

/** What a guess sends to the scorer — a chosen option or typed text. */
export type Guess = { taxonId?: number; text?: string };

/** The playable shape of a round, shared by solo (`Round`) and VS (`ClientRound`). */
export interface PlayableRound {
  token: string;
  photos: RoundPhoto[];
  options: RoundOption[] | null;
}

async function submitGuess(payload: Guess & { token: string; mode: GameMode }): Promise<GuessResult> {
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

interface RoundCardProps {
  round: PlayableRound;
  mode: GameMode;
  lifelinesLeft: number;
  onUseLifeline: () => void;
  /** Fires once the round is answered, with the result and the raw guess made. */
  onAnswered: (result: GuessResult, guess: Guess) => void;
  /** Rendered beside the result (e.g. a "Next plant" button) once answered. */
  nextButton?: ReactNode;
}

/**
 * One plant round: photo, answer input (multiple-choice or typed), optional
 * lifeline, and the post-answer result line. Owns its own per-round state, so
 * callers should give it a `key` that changes each round to reset it.
 */
export default function RoundCard({
  round,
  mode,
  lifelinesLeft,
  onUseLifeline,
  onAnswered,
  nextButton,
}: RoundCardProps) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [revealedOptions, setRevealedOptions] = useState<RoundOption[] | null>(null);
  const [result, setResult] = useState<GuessResult | null>(null);
  const [pending, setPending] = useState(false);
  const [lifelinePending, setLifelinePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);

  const options = round.options ?? revealedOptions;
  const canUseLifeline =
    mode !== "normal" && !result && revealedOptions == null && lifelinesLeft > 0;

  const photos = round.photos ?? [];
  const current = photos.length ? photoIdx % photos.length : 0;
  const photo = photos[current];

  async function answer(guess: Guess) {
    if (result || pending) return;
    setPending(true);
    setError(null);
    try {
      const r = await submitGuess({ ...guess, token: round.token, mode });
      setResult(r);
      onAnswered(r, guess);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  function pickOption(taxonId: number) {
    setChosen(taxonId);
    void answer({ taxonId });
  }

  function submitTyped() {
    if (!typed.trim()) return;
    void answer({ text: typed });
  }

  async function useLifeline() {
    if (lifelinePending) return;
    setLifelinePending(true);
    try {
      const opts = await fetchLifeline(round.token);
      setRevealedOptions(opts);
      onUseLifeline();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLifelinePending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {photo && (
      <figure className="overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
        <div className="relative bg-black/5 dark:bg-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.url}
            alt="An organism observed near you — can you identify it?"
            className="h-80 w-full object-contain"
          />
          {photos.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-lg leading-none text-white transition hover:bg-black/65"
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Next photo"
                onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-lg leading-none text-white transition hover:bg-black/65"
              >
                ›
              </button>
              <div className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-xs tabular-nums text-white">
                {current + 1} / {photos.length}
              </div>
            </>
          )}
        </div>
        <figcaption className="px-3 py-2 text-xs opacity-60">
          Photo: {photo.attribution || "iNaturalist contributor"}
          {photo.licenseCode ? ` (${photo.licenseCode})` : ""} ·{" "}
          <a href={photo.observationUrl} target="_blank" rel="noreferrer" className="underline">
            View on iNaturalist
          </a>
        </figcaption>
      </figure>
      )}

      {mode !== "normal" && (
        <div className="flex items-center justify-between text-sm">
          <span className="opacity-70">Lifelines: {"💡".repeat(lifelinesLeft) || "—"}</span>
          {canUseLifeline && (
            <button
              onClick={useLifeline}
              disabled={lifelinePending}
              className="rounded-md border border-green-600 px-3 py-1 font-medium text-green-700 transition hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-950/30"
            >
              {lifelinePending ? "Revealing…" : "Use a lifeline"}
            </button>
          )}
        </div>
      )}

      {options ? (
        <div className="grid gap-2">
          {options.map((opt) => {
            const isCorrect = result?.correctTaxonId === opt.taxonId;
            const isChosenWrong = result != null && chosen === opt.taxonId && !result.correct;
            let style =
              "border-black/15 hover:border-green-500 hover:bg-green-50 dark:border-white/20 dark:hover:bg-green-950/30";
            if (result) {
              if (isCorrect) style = "border-green-600 bg-green-100 dark:bg-green-900/40";
              else if (isChosenWrong) style = "border-red-500 bg-red-100 dark:bg-red-900/40";
              else style = "border-black/10 opacity-60 dark:border-white/10";
            }
            return (
              <button
                key={opt.taxonId}
                onClick={() => pickOption(opt.taxonId)}
                disabled={result != null || pending}
                className={`rounded-lg border px-4 py-3 text-left transition ${style}`}
              >
                <span className="block font-medium">{opt.commonName ?? opt.scientificName}</span>
                {opt.commonName && (
                  <span className="block text-xs italic opacity-60">{opt.scientificName}</span>
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
            placeholder={mode === "botanist" ? "Scientific name…" : "Common name…"}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitTyped()}
            className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
          />
          <button
            onClick={submitTyped}
            disabled={result != null || pending || !typed.trim()}
            className="rounded-lg bg-green-600 px-4 py-2 font-semibold text-white transition hover:bg-green-700 disabled:opacity-40"
          >
            Guess
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {result && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-semibold">{result.correct ? "✅ Correct!" : "❌ Not quite."}</span>
            <div className="opacity-70">
              {result.commonName ? `${result.commonName} · ` : ""}
              <span className="italic">{result.scientificName}</span>
            </div>
          </div>
          {nextButton}
        </div>
      )}
    </div>
  );
}
