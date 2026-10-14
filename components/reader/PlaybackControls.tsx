"use client";

import { type ReactNode, type Ref, useId } from "react";
import type { SpeechStatus } from "@/lib/speech/controller";
import { SETTING_LIMITS } from "@/lib/settings";

export function formatRate(rate: number): string {
  return `${rate.toFixed(1)}×`;
}

const BUTTON =
  "inline-flex min-h-14 min-w-14 items-center justify-center gap-2 rounded-xl border-2 border-fg bg-surface px-4 py-2 text-lg font-bold text-fg disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY =
  "inline-flex min-h-14 min-w-32 items-center justify-center gap-2 rounded-xl border-2 border-accent bg-accent px-5 py-2 text-lg font-bold text-accent-fg disabled:cursor-not-allowed disabled:opacity-60";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="currentColor"
    >
      {children}
    </svg>
  );
}

const PlayIcon = () => (
  <Icon>
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" />
  </Icon>
);
const PauseIcon = () => (
  <Icon>
    <rect x="5" y="4" width="5" height="16" rx="1" />
    <rect x="14" y="4" width="5" height="16" rx="1" />
  </Icon>
);
const StopIcon = () => (
  <Icon>
    <rect x="5" y="5" width="14" height="14" rx="1.5" />
  </Icon>
);
const PrevIcon = () => (
  <Icon>
    <rect x="4" y="5" width="3" height="14" rx="1" />
    <path d="M20 5.5v13a1 1 0 0 1-1.55.83l-9.5-6.5a1 1 0 0 1 0-1.66l9.5-6.5A1 1 0 0 1 20 5.5Z" />
  </Icon>
);
const NextIcon = () => (
  <Icon>
    <rect x="17" y="5" width="3" height="14" rx="1" />
    <path d="M4 5.5v13a1 1 0 0 0 1.55.83l9.5-6.5a1 1 0 0 0 0-1.66l-9.5-6.5A1 1 0 0 0 4 5.5Z" />
  </Icon>
);

export interface PlaybackControlsProps {
  status: SpeechStatus;
  sentenceIndex: number;
  sentenceCount: number;
  rate: number;
  /** False when speech synthesis is unavailable: Play/Pause and Stop are disabled. */
  speechAvailable: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRateChange: (rate: number) => void;
  playButtonRef?: Ref<HTMLButtonElement>;
}

export function PlaybackControls({
  status,
  sentenceIndex,
  sentenceCount,
  rate,
  speechAvailable,
  onTogglePlay,
  onStop,
  onPrevious,
  onNext,
  onRateChange,
  playButtonRef,
}: PlaybackControlsProps) {
  const uid = useId();
  const playing = status === "playing";
  const current = sentenceCount > 0 ? Math.min(sentenceIndex + 1, sentenceCount) : 0;
  const progressText = `Sentence ${current} of ${sentenceCount}`;
  const percent = sentenceCount > 0 ? (current / sentenceCount) * 100 : 0;

  return (
    <div
      role="group"
      aria-label="Playback"
      className="space-y-4 rounded-xl border-2 border-fg bg-surface p-4 text-fg"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          ref={playButtonRef}
          type="button"
          onClick={onTogglePlay}
          disabled={!speechAvailable}
          className={PRIMARY}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          <span>{playing ? "Pause" : "Play"}</span>
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={!speechAvailable}
          className={BUTTON}
        >
          <StopIcon />
          <span>Stop</span>
        </button>
        <button
          type="button"
          onClick={onPrevious}
          className={BUTTON}
        >
          <PrevIcon />
          <span>Previous sentence</span>
        </button>
        <button
          type="button"
          onClick={onNext}
          className={BUTTON}
        >
          <NextIcon />
          <span>Next sentence</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={`${uid}-rate`} className="text-lg font-bold">
            Reading speed
          </label>
          <input
            id={`${uid}-rate`}
            type="range"
            min={SETTING_LIMITS.rate.min}
            max={SETTING_LIMITS.rate.max}
            step={0.1}
            value={rate}
            aria-valuetext={formatRate(rate)}
            onChange={(e) => onRateChange(Math.round(Number(e.target.value) * 10) / 10)}
            className="h-12 w-48 accent-[var(--accent)]"
          />
          <output htmlFor={`${uid}-rate`} className="min-w-12 text-lg font-bold" aria-hidden="true">
            {formatRate(rate)}
          </output>
        </div>

        <div className="flex min-w-60 flex-1 flex-col gap-2">
          <p id={`${uid}-progress`} className="text-lg">
            {progressText}
          </p>
          <div
            role="progressbar"
            aria-labelledby={`${uid}-progress`}
            aria-valuemin={0}
            aria-valuemax={sentenceCount}
            aria-valuenow={current}
            aria-valuetext={progressText}
            className="h-3 w-full overflow-hidden rounded-full border-2 border-fg"
          >
            <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
