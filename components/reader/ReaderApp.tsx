"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImportPanel } from "@/components/input/ImportPanel";
import type { ImportedText } from "@/components/input/types";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettings } from "@/hooks/useSettings";
import { useSpeech } from "@/hooks/useSpeech";
import { useVoices } from "@/hooks/useVoices";
import {
  deleteDocument,
  listDocuments,
  saveDocument,
  updateProgress,
  type SavedDocument,
} from "@/lib/documents";
import { DEFAULT_SETTINGS, SETTING_LIMITS, THEMES } from "@/lib/settings";
import {
  SpeechController,
  UNSUPPORTED_ERROR,
  type SpeechControllerDeps,
} from "@/lib/speech/controller";
import { THEME_NAMES } from "@/lib/themes";
import { Announcer, useAnnouncer } from "./Announcer";
import { Footer } from "./Footer";
import { PlaybackControls, formatRate } from "./PlaybackControls";
import { ReaderView } from "./ReaderView";
import { RecentDocuments } from "./RecentDocuments";
import { SettingsPanel } from "./SettingsPanel";
import { ShortcutsDialog } from "./ShortcutsDialog";

export const SAMPLE_SENTENCE = "This is how the reading voice sounds with your settings.";
/** Debounce for saving the reading position. */
export const PROGRESS_SAVE_DELAY_MS = 500;

const HEADER_BUTTON =
  "min-h-12 min-w-12 rounded-lg border-2 border-fg bg-bg px-4 py-2 text-lg font-bold text-fg";
const SECONDARY_BUTTON =
  "min-h-12 min-w-12 rounded-lg border-2 border-fg bg-surface px-4 py-2 text-lg font-bold text-fg";
const PRIMARY_BUTTON =
  "min-h-12 min-w-12 rounded-lg border-2 border-accent bg-accent px-4 py-2 text-lg font-bold text-accent-fg";

export interface ReaderAppProps {
  /** Storage for settings and documents (default: localStorage). */
  storage?: Storage;
  /** Injected speech synthesis (tests). Default: window.speechSynthesis. */
  speechDeps?: SpeechControllerDeps;
}

export function ReaderApp({ storage, speechDeps }: ReaderAppProps = {}) {
  const { settings, update, reset } = useSettings(storage);
  const [doc, setDoc] = useState<SavedDocument | null>(null);
  const [documents, setDocuments] = useState<SavedDocument[]>([]);
  const [resumeIndex, setResumeIndex] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null);
  const [announcement, announce] = useAnnouncer();

  const text = doc?.text ?? "";
  const speechOptions = useMemo(
    () => ({
      rate: settings.rate,
      pitch: settings.pitch,
      volume: settings.volume,
      voiceURI: settings.voiceURI,
    }),
    [settings.rate, settings.pitch, settings.volume, settings.voiceURI],
  );
  const speech = useSpeech(text, speechOptions, speechDeps);
  const { state, sentences } = speech;
  const voices = useVoices(speechDeps?.synth);

  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const shortcutsButtonRef = useRef<HTMLButtonElement>(null);
  const shortcutsReturnRef = useRef<HTMLElement | null>(null);
  const homeHeadingRef = useRef<HTMLHeadingElement>(null);
  const readerHeadingRef = useRef<HTMLHeadingElement>(null);
  const recentHeadingRef = useRef<HTMLHeadingElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const focusRequest = useRef<"reader" | "home" | null>(null);
  const stopRequested = useRef(false);
  const pendingProgress = useRef<{ id: string; index: number } | null>(null);

  // --- mount ---------------------------------------------------------------
  useEffect(() => {
    setSpeechSupported(Boolean(speechDeps?.synth) || SpeechController.isSupported());
    setDocuments(listDocuments(storage));
    // Injected deps / storage are fixed for the lifetime of the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const speechAvailable = speechSupported !== false;

  // --- theme on <html> -------------------------------------------------------
  useEffect(() => {
    // useSettings starts with the DEFAULT_SETTINGS object itself and replaces
    // it with the stored settings after mount; don't flash the default theme
    // over the one the pre-paint script in the layout already applied.
    if (settings === DEFAULT_SETTINGS) return;
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings]);

  // --- focus management after screen changes ---------------------------------
  useEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (request === "reader" && doc) readerHeadingRef.current?.focus();
    else if (request === "home" && !doc) homeHeadingRef.current?.focus();
  }, [doc]);

  // --- status announcements -------------------------------------------------
  const prevStatus = useRef(state.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = state.status;
    if (prev === state.status) return;
    if (state.status === "playing") {
      announce("Playing");
    } else if (state.status === "paused") {
      announce("Paused");
    } else if (stopRequested.current) {
      announce("Stopped");
    } else if (state.error) {
      announce("Reading stopped because of an error");
    } else if (state.sentenceCount > 0 && state.sentenceIndex >= state.sentenceCount - 1) {
      announce("Finished reading");
    } else {
      announce("Stopped");
    }
    stopRequested.current = false;
  }, [state.status, state.error, state.sentenceIndex, state.sentenceCount, announce]);

  // Once reading starts the resume offer is no longer relevant.
  useEffect(() => {
    if (state.status === "playing") setResumeIndex(null);
  }, [state.status]);

  // --- save reading position (debounced) -------------------------------------
  const docId = doc?.id ?? null;
  useEffect(() => {
    if (!docId || state.status === "idle") return;
    const entry = { id: docId, index: state.sentenceIndex };
    pendingProgress.current = entry;
    const timer = setTimeout(() => {
      updateProgress(entry.id, entry.index, storage);
      if (pendingProgress.current === entry) pendingProgress.current = null;
    }, PROGRESS_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [docId, state.sentenceIndex, state.status, storage]);

  const flushProgress = useCallback(() => {
    const entry = pendingProgress.current;
    pendingProgress.current = null;
    if (entry) updateProgress(entry.id, entry.index, storage);
  }, [storage]);

  // Save on unmount / page hide too.
  useEffect(() => {
    window.addEventListener("pagehide", flushProgress);
    return () => {
      window.removeEventListener("pagehide", flushProgress);
      flushProgress();
    };
  }, [flushProgress]);

  // --- actions ---------------------------------------------------------------
  const openDocument = useCallback((d: SavedDocument) => {
    focusRequest.current = "reader";
    setResumeIndex(d.lastSentenceIndex > 0 ? d.lastSentenceIndex : null);
    setDoc(d);
  }, []);

  const handleImport = useCallback(
    (imported: ImportedText) => {
      const saved = saveDocument(imported, storage);
      setDocuments(listDocuments(storage));
      openDocument(saved);
    },
    [storage, openDocument],
  );

  const handleOpenRecent = useCallback(
    (d: SavedDocument) => {
      openDocument(d);
    },
    [openDocument],
  );

  const handleDelete = useCallback(
    (d: SavedDocument) => {
      deleteDocument(d.id, storage);
      setDocuments(listDocuments(storage));
      announce(`Deleted ${d.title}`);
      recentHeadingRef.current?.focus();
    },
    [storage, announce],
  );

  const stop = useCallback(() => {
    if (state.status !== "idle") stopRequested.current = true;
    speech.stop();
  }, [speech, state.status]);

  const goHome = useCallback(() => {
    stop();
    flushProgress();
    setDocuments(listDocuments(storage));
    setResumeIndex(null);
    focusRequest.current = "home";
    setDoc(null);
  }, [stop, flushProgress, storage]);

  /** Start reading at a sentence (or just move there when speech is unavailable). */
  const readFrom = useCallback(
    (index: number) => {
      if (speechAvailable) speech.play(index);
      else speech.jumpTo(index);
    },
    [speech, speechAvailable],
  );

  const handleResume = useCallback(
    (index: number) => {
      setResumeIndex(null);
      readFrom(index);
      playButtonRef.current?.focus();
    },
    [readFrom],
  );

  const togglePlay = useCallback(() => {
    if (!speechAvailable) return;
    speech.toggle();
  }, [speech, speechAvailable]);

  const changeTextSize = useCallback(
    (delta: number) => {
      const { min, max } = SETTING_LIMITS.fontSize;
      const fontSize = Math.min(max, Math.max(min, settings.fontSize + delta));
      update({ fontSize });
      announce(`Text size ${fontSize}`);
    },
    [settings.fontSize, update, announce],
  );

  const changeRate = useCallback(
    (delta: number) => {
      const { min, max } = SETTING_LIMITS.rate;
      const rate = Math.min(max, Math.max(min, Math.round((settings.rate + delta) * 10) / 10));
      update({ rate });
      announce(`Speed ${formatRate(rate)}`);
    },
    [settings.rate, update, announce],
  );

  const cycleTheme = useCallback(() => {
    const i = THEMES.indexOf(settings.theme);
    const theme = THEMES[(i + 1) % THEMES.length];
    update({ theme });
    announce(`Theme: ${THEME_NAMES[theme]}`);
  }, [settings.theme, update, announce]);

  const toggleFocusView = useCallback(() => {
    const viewMode = settings.viewMode === "focus" ? "full" : "focus";
    update({ viewMode });
    announce(viewMode === "focus" ? "Focus view on" : "Focus view off");
  }, [settings.viewMode, update, announce]);

  const openShortcuts = useCallback(() => {
    const active = document.activeElement;
    shortcutsReturnRef.current =
      active instanceof HTMLElement && active !== document.body
        ? active
        : shortcutsButtonRef.current;
    setShortcutsOpen(true);
  }, []);

  const handleReset = useCallback(() => {
    reset();
    announce("Settings reset to defaults");
  }, [reset, announce]);

  const testVoice = useCallback(() => {
    const synth =
      speechDeps?.synth ?? (typeof window !== "undefined" ? window.speechSynthesis : undefined);
    const Utterance =
      speechDeps?.Utterance ??
      (typeof SpeechSynthesisUtterance !== "undefined" ? SpeechSynthesisUtterance : undefined);
    if (!synth || !Utterance) return;
    stop();
    try {
      synth.cancel();
      const u = new Utterance(SAMPLE_SENTENCE);
      u.rate = settings.rate;
      u.pitch = settings.pitch;
      u.volume = settings.volume;
      const voice = settings.voiceURI
        ? synth.getVoices().find((v) => v.voiceURI === settings.voiceURI)
        : undefined;
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      synth.speak(u);
    } catch {
      // ignore: nothing more we can do
    }
  }, [speechDeps, stop, settings.rate, settings.pitch, settings.volume, settings.voiceURI]);

  // --- keyboard shortcuts ----------------------------------------------------
  const inReader = doc !== null;
  const lastIndex = Math.max(0, sentences.length - 1);
  useKeyboardShortcuts({
    togglePlay: inReader && speechAvailable ? togglePlay : undefined,
    stop: inReader ? stop : undefined,
    next: inReader ? speech.next : undefined,
    previous: inReader ? speech.previous : undefined,
    first: inReader ? () => speech.jumpTo(0) : undefined,
    last: inReader ? () => speech.jumpTo(lastIndex) : undefined,
    textLarger: () => changeTextSize(4),
    textSmaller: () => changeTextSize(-4),
    speedUp: () => changeRate(0.1),
    speedDown: () => changeRate(-0.1),
    toggleFocusView,
    cycleTheme,
    showHelp: openShortcuts,
  });

  const dialogOpen = settingsOpen || shortcutsOpen;
  const showError = state.error && state.error !== UNSUPPORTED_ERROR;

  return (
    <>
      <div inert={dialogOpen} className="flex min-h-screen flex-col bg-bg text-fg">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="border-b-2 border-fg bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-2xl font-bold">ReadAloud</p>
            <div className="flex flex-wrap gap-3">
              <button
                ref={settingsButtonRef}
                type="button"
                aria-haspopup="dialog"
                onClick={() => setSettingsOpen(true)}
                className={HEADER_BUTTON}
              >
                Settings
              </button>
              <button
                ref={shortcutsButtonRef}
                type="button"
                aria-haspopup="dialog"
                onClick={openShortcuts}
                className={HEADER_BUTTON}
              >
                Keyboard shortcuts
              </button>
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 outline-none">
          {speechSupported === false && (
            <div
              role="note"
              aria-label="Speech not available"
              className="rounded-xl border-4 border-fg bg-surface p-4 text-lg"
            >
              <p className="font-bold">Reading aloud is not available in this browser.</p>
              <p>
                You can still read the text with highlighting and change the display settings. To
                hear the text, try a recent version of Chrome, Edge, Safari or Firefox.
              </p>
            </div>
          )}

          {doc === null ? (
            <div className="space-y-8">
              <h1 ref={homeHeadingRef} tabIndex={-1} className="text-3xl font-bold sm:text-4xl">
                What would you like to read?
              </h1>
              <ImportPanel onImport={handleImport} />
              <RecentDocuments
                documents={documents}
                onOpen={handleOpenRecent}
                onDelete={handleDelete}
                headingRef={recentHeadingRef}
              />
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={goHome} className={SECONDARY_BUTTON}>
                  New document
                </button>
              </div>
              <h1
                ref={readerHeadingRef}
                tabIndex={-1}
                className="text-3xl font-bold break-words sm:text-4xl"
              >
                {doc.title}
              </h1>

              {resumeIndex !== null && resumeIndex < sentences.length && (
                <div
                  role="group"
                  aria-label="Resume reading"
                  className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-fg bg-surface p-4"
                >
                  <p className="w-full text-lg">You read part of this document before.</p>
                  <button
                    type="button"
                    onClick={() => handleResume(resumeIndex)}
                    className={PRIMARY_BUTTON}
                  >
                    Continue from sentence {resumeIndex + 1}
                  </button>
                  <button type="button" onClick={() => handleResume(0)} className={SECONDARY_BUTTON}>
                    Start from beginning
                  </button>
                </div>
              )}

              {showError && (
                <div role="alert" className="rounded-xl border-4 border-fg bg-surface p-4 text-lg">
                  Reading stopped because the speech engine reported a problem. Press Play to try
                  again.
                </div>
              )}

              <PlaybackControls
                status={state.status}
                sentenceIndex={state.sentenceIndex}
                sentenceCount={sentences.length}
                rate={settings.rate}
                speechAvailable={speechAvailable}
                onTogglePlay={togglePlay}
                onStop={stop}
                onPrevious={speech.previous}
                onNext={speech.next}
                onRateChange={(rate) => update({ rate })}
                playButtonRef={playButtonRef}
              />

              <ReaderView
                text={text}
                currentIndex={state.sentenceIndex}
                wordRange={state.wordRange}
                settings={settings}
                onActivate={readFrom}
              />
            </div>
          )}
        </main>
        <Footer />
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={update}
        onTextSizeStep={changeTextSize}
        onReset={handleReset}
        onTestVoice={testVoice}
        voices={voices}
        speechAvailable={speechAvailable}
        returnFocusRef={settingsButtonRef}
      />
      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        returnFocusRef={shortcutsReturnRef}
      />
      <Announcer message={announcement} />
    </>
  );
}
