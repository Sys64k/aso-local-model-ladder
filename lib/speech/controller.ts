import { splitSentences, type Sentence } from "../text/segment";

export type SpeechStatus = "idle" | "playing" | "paused";

export interface SpeechState {
  status: SpeechStatus;
  sentenceIndex: number;
  sentenceCount: number;
  /** Absolute char offsets in the loaded text of the word being spoken. */
  wordRange: { start: number; end: number } | null;
  error: string | null;
}

export interface SpeechOptions {
  rate: number;
  pitch: number;
  volume: number;
  voiceURI: string | null;
}

export interface SpeechControllerDeps {
  synth?: SpeechSynthesis;
  Utterance?: typeof SpeechSynthesisUtterance;
  /** How long after resume() to check whether speech actually restarted. */
  resumeCheckMs?: number;
  /** Pauses at least this long are treated as suspicious (Chrome drops speech after ~15 s). */
  longPauseMs?: number;
}

export const DEFAULT_SPEECH_OPTIONS: SpeechOptions = {
  rate: 1,
  pitch: 1,
  volume: 1,
  voiceURI: null,
};

export const UNSUPPORTED_ERROR = "Speech synthesis is not supported in this browser.";

function defaultSynth(): SpeechSynthesis | undefined {
  try {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      return window.speechSynthesis;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function defaultUtterance(): typeof SpeechSynthesisUtterance | undefined {
  return typeof SpeechSynthesisUtterance !== "undefined"
    ? SpeechSynthesisUtterance
    : undefined;
}

function safeGetVoices(synth: SpeechSynthesis): SpeechSynthesisVoice[] {
  try {
    return synth.getVoices() ?? [];
  } catch {
    return [];
  }
}

type Listener = (s: SpeechState) => void;

/**
 * Drives the Web Speech API one sentence at a time. Each utterance gets a
 * generation number; events from utterances of an older generation (i.e.
 * cancelled ones) are ignored.
 */
export class SpeechController {
  private synth?: SpeechSynthesis;
  private Utterance?: typeof SpeechSynthesisUtterance;
  private resumeCheckMs: number;
  private longPauseMs: number;

  private sentences: Sentence[] = [];
  private status: SpeechStatus = "idle";
  private index = 0;
  private wordRange: { start: number; end: number } | null = null;
  private error: string | null = null;
  private options: SpeechOptions = { ...DEFAULT_SPEECH_OPTIONS };

  private generation = 0;
  /** Incremented on every event from the live utterance; used to detect a dead resume. */
  private activity = 0;
  private finished = false;
  /** Set when the target sentence/options changed while paused: resume() re-speaks. */
  private pendingRestart = false;
  private pausedAt = 0;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Keep a reference so the utterance is not garbage-collected mid-speech (Chrome bug). */
  private current: SpeechSynthesisUtterance | null = null;
  private listeners = new Set<Listener>();
  private state: SpeechState;
  private disposed = false;

  constructor(deps: SpeechControllerDeps = {}) {
    this.synth = deps.synth ?? defaultSynth();
    this.Utterance = deps.Utterance ?? defaultUtterance();
    this.resumeCheckMs = deps.resumeCheckMs ?? 400;
    this.longPauseMs = deps.longPauseMs ?? 10_000;
    this.state = this.snapshot();
  }

  static isSupported(): boolean {
    return defaultSynth() !== undefined && defaultUtterance() !== undefined;
  }

  load(text: string): void {
    this.halt();
    this.sentences = splitSentences(text ?? "");
    this.index = 0;
    this.error = null;
    this.finished = false;
    this.emit();
  }

  getSentences(): Sentence[] {
    return this.sentences;
  }

  play(fromSentence?: number): void {
    if (this.disposed || this.sentences.length === 0) return;
    if (fromSentence === undefined) {
      if (this.status === "paused") {
        this.resume();
        return;
      }
      if (this.status === "playing") return;
      if (this.finished) this.index = 0;
    } else {
      this.index = this.clampIndex(fromSentence);
    }
    this.finished = false;
    this.error = null;
    if (!this.synth || !this.Utterance) {
      this.error = UNSUPPORTED_ERROR;
      this.emit();
      return;
    }
    this.speakCurrent();
  }

  pause(): void {
    if (this.status !== "playing" || !this.synth) return;
    this.clearResumeTimer();
    try {
      this.synth.pause();
    } catch {
      // ignore
    }
    this.status = "paused";
    this.pausedAt = Date.now();
    this.emit();
  }

  resume(): void {
    if (this.status !== "paused" || !this.synth) return;
    if (this.pendingRestart || !this.current) {
      this.speakCurrent();
      return;
    }
    const synth = this.synth;
    const gen = this.generation;
    const activityAtResume = this.activity;
    const pausedFor = Date.now() - this.pausedAt;
    try {
      synth.resume();
    } catch {
      // ignore
    }
    this.status = "playing";
    this.emit();
    // Chrome sometimes silently drops speech after a long pause and resume()
    // does nothing. If no event arrives and the synth looks dead, re-speak.
    this.clearResumeTimer();
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (gen !== this.generation || this.status !== "playing") return;
      if (this.activity !== activityAtResume) return;
      if (synth.paused || !synth.speaking || pausedFor >= this.longPauseMs) {
        this.speakCurrent();
      }
    }, this.resumeCheckMs);
  }

  toggle(): void {
    if (this.status === "playing") this.pause();
    else if (this.status === "paused") this.resume();
    else this.play();
  }

  stop(): void {
    this.halt();
    this.emit();
  }

  next(): void {
    if (this.index >= this.sentences.length - 1) return;
    this.goTo(this.index + 1);
  }

  previous(): void {
    if (this.index <= 0) return;
    this.goTo(this.index - 1);
  }

  jumpTo(index: number): void {
    if (this.sentences.length === 0 || !Number.isFinite(index)) return;
    this.goTo(this.clampIndex(index));
  }

  setOptions(o: Partial<SpeechOptions>): void {
    const nextOptions = { ...this.options };
    let changed = false;
    for (const key of Object.keys(DEFAULT_SPEECH_OPTIONS) as (keyof SpeechOptions)[]) {
      const value = o[key];
      if (value === undefined || value === this.options[key]) continue;
      (nextOptions as Record<string, unknown>)[key] = value;
      changed = true;
    }
    if (!changed) return;
    this.options = nextOptions;
    if (this.status === "playing") this.speakCurrent();
    else if (this.status === "paused") this.pendingRestart = true;
  }

  getOptions(): SpeechOptions {
    return { ...this.options };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): SpeechState {
    return this.state;
  }

  dispose(): void {
    this.listeners.clear();
    this.halt();
    this.disposed = true;
  }

  // ---------------------------------------------------------------------------

  private clampIndex(i: number): number {
    const max = Math.max(0, this.sentences.length - 1);
    return Math.min(max, Math.max(0, Math.floor(i)));
  }

  private goTo(i: number): void {
    this.finished = false;
    this.wordRange = null;
    if (this.status === "playing") {
      this.index = i;
      this.speakCurrent();
    } else if (this.status === "paused") {
      this.invalidate();
      this.index = i;
      this.pendingRestart = true;
      this.emit();
    } else {
      this.index = i;
      this.emit();
    }
  }

  /** Cancel the live utterance (its late events become stale). */
  private invalidate(): void {
    this.generation++;
    this.clearResumeTimer();
    this.current = null;
    try {
      this.synth?.cancel();
    } catch {
      // ignore
    }
  }

  /** Stop speaking without emitting. */
  private halt(): void {
    const wasPaused = this.status === "paused";
    this.invalidate();
    if (wasPaused) {
      try {
        this.synth?.resume();
      } catch {
        // ignore
      }
    }
    this.status = "idle";
    this.wordRange = null;
    this.pendingRestart = false;
  }

  private speakCurrent(): void {
    const synth = this.synth;
    const Utterance = this.Utterance;
    const sentence = this.sentences[this.index];
    if (!synth || !Utterance || !sentence || this.disposed) return;

    const wasPaused = this.status === "paused";
    this.invalidate();
    if (wasPaused || synth.paused) {
      try {
        synth.resume();
      } catch {
        // ignore
      }
    }
    const gen = this.generation;

    const u = new Utterance(sentence.text);
    u.rate = this.options.rate;
    u.pitch = this.options.pitch;
    u.volume = this.options.volume;
    if (this.options.voiceURI) {
      const voice = safeGetVoices(synth).find((v) => v.voiceURI === this.options.voiceURI);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
    }

    u.onstart = () => {
      if (gen !== this.generation) return;
      this.activity++;
    };
    u.onboundary = (e: SpeechSynthesisEvent) => {
      if (gen !== this.generation) return;
      this.activity++;
      if (e.name !== "word") return;
      this.setWordRange(sentence, e.charIndex, e.charLength);
    };
    u.onend = () => {
      if (gen !== this.generation) return;
      this.activity++;
      this.handleEnd();
    };
    u.onerror = (e: SpeechSynthesisErrorEvent) => {
      if (gen !== this.generation) return;
      const code = e?.error;
      if (code === "interrupted" || code === "canceled") return;
      this.invalidate();
      this.status = "idle";
      this.wordRange = null;
      this.error = code || "synthesis-failed";
      this.emit();
    };

    this.current = u;
    this.status = "playing";
    this.wordRange = null;
    this.pendingRestart = false;
    this.error = null;
    this.emit();
    try {
      synth.speak(u);
    } catch (err) {
      this.invalidate();
      this.status = "idle";
      this.error = err instanceof Error ? err.message : "synthesis-failed";
      this.emit();
    }
  }

  private setWordRange(sentence: Sentence, charIndex: number, charLength?: number) {
    const text = sentence.text;
    if (typeof charIndex !== "number" || charIndex < 0 || charIndex >= text.length) return;
    // We speak sentence.text, which starts exactly at sentence.start (the
    // sentence offsets are already trimmed), so the leading offset is 0.
    const leading = 0;
    let length =
      typeof charLength === "number" && charLength > 0
        ? charLength
        : (/^\S+/.exec(text.slice(charIndex))?.[0].length ?? 0);
    if (length === 0) return;
    length = Math.min(length, text.length - charIndex);
    const start = sentence.start + leading + charIndex;
    this.wordRange = { start, end: start + length };
    this.emit();
  }

  private handleEnd(): void {
    if (this.index < this.sentences.length - 1) {
      this.index++;
      this.speakCurrent();
      return;
    }
    this.invalidate();
    this.status = "idle";
    this.wordRange = null;
    this.finished = true;
    this.emit();
  }

  private clearResumeTimer(): void {
    if (this.resumeTimer !== null) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  private snapshot(): SpeechState {
    return {
      status: this.status,
      sentenceIndex: this.index,
      sentenceCount: this.sentences.length,
      wordRange: this.wordRange,
      error: this.error,
    };
  }

  private emit(): void {
    this.state = this.snapshot();
    const state = this.state;
    for (const l of Array.from(this.listeners)) l(state);
  }
}

/**
 * Resolve the available voices. Chrome returns an empty list at first and
 * fires `voiceschanged` once voices are loaded; we wait for that (up to
 * timeoutMs) and then return whatever is available.
 */
export function loadVoices(
  synth: SpeechSynthesis | undefined = defaultSynth(),
  timeoutMs = 2000,
): Promise<SpeechSynthesisVoice[]> {
  if (!synth) return Promise.resolve([]);
  const initial = safeGetVoices(synth);
  if (initial.length > 0) return Promise.resolve(initial);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        synth.removeEventListener?.("voiceschanged", finish);
      } catch {
        // ignore
      }
      resolve(safeGetVoices(synth));
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      synth.addEventListener?.("voiceschanged", finish);
    } catch {
      // ignore
    }
  });
}
