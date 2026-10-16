"use client";

import { useId } from "react";
import { NOTE_MAX_LENGTH } from "@/lib/documents";

const BUTTON =
  "min-h-12 min-w-12 rounded-lg border-2 border-fg bg-bg px-4 py-2 text-lg font-bold text-fg disabled:cursor-not-allowed disabled:opacity-60";

export interface NotesPanelProps {
  value: string;
  onChange: (value: string) => void;
  saveStatus: "saved" | "saving";
  /** True while the note is being read aloud. */
  reading: boolean;
  /** False when speech synthesis is unavailable: the Read note button is disabled. */
  speechAvailable: boolean;
  onRead: () => void;
  onStopReading: () => void;
}

/** Per-document notes scratchpad shown beside (lg) or below the document text. */
export function NotesPanel({
  value,
  onChange,
  saveStatus,
  reading,
  speechAvailable,
  onRead,
  onStopReading,
}: NotesPanelProps) {
  const uid = useId();
  const noteId = `${uid}-note`;
  const hintId = `${uid}-hint`;
  const blank = value.trim() === "";
  const disabled = !speechAvailable || (blank && !reading);

  return (
    <section
      aria-labelledby="notes-heading"
      className="space-y-3 self-start rounded-xl border-2 border-fg bg-surface p-4 text-fg"
    >
      <h2 id="notes-heading" className="text-2xl font-bold">
        Notes
      </h2>
      <div className="space-y-2">
        <label htmlFor={noteId} className="block text-lg font-bold">
          Note for this document
        </label>
        <textarea
          id={noteId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={NOTE_MAX_LENGTH}
          rows={8}
          aria-describedby={hintId}
          className="block min-h-48 w-full rounded-lg border-2 border-fg bg-bg p-3 text-lg text-fg"
        />
        <p id={hintId} className="text-lg">
          Saved automatically on this device.
        </p>
        <p data-testid="note-save-status" className="text-lg font-bold">
          {saveStatus === "saving" ? "Saving…" : "Saved"}
        </p>
      </div>
      <button
        type="button"
        onClick={reading ? onStopReading : onRead}
        disabled={disabled}
        className={BUTTON}
      >
        {reading ? "Stop reading note" : "Read note"}
      </button>
    </section>
  );
}
