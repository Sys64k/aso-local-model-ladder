/**
 * A reusable fake of the Web Speech synthesis API for tests.
 *
 * - `FakeUtterance` stands in for `SpeechSynthesisUtterance`.
 * - `FakeSpeechSynthesis` stands in for `window.speechSynthesis`. It records
 *   every spoken utterance (`spoken`) and every method call (`calls`).
 *
 * Two modes:
 * - manual (default): nothing happens until the test calls `fireStart()`,
 *   `fireBoundary()`, `fireWord()`, `fireEnd()` / `finishCurrent()` or
 *   `fireError()`.
 * - auto (`{ auto: true }`): on timers (works with `vi.useFakeTimers()`), the
 *   current utterance fires `start`, one `boundary` per word every
 *   `wordIntervalMs`, then `end`, and the next queued utterance starts.
 *
 * Use `createFakeSpeech()` to get correctly-typed `synth`/`Utterance` values for
 * dependency injection, or `installFakeSpeech()` to put them on the global
 * object (for code that reads `window.speechSynthesis`).
 */

export interface FakeSpeechEvent {
  type: string;
  utterance: FakeUtterance;
  charIndex: number;
  charLength?: number;
  name?: string;
  elapsedTime: number;
  error?: string;
}

type Handler = ((e: FakeSpeechEvent) => void) | null;

export class FakeUtterance {
  text: string;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: Handler = null;
  onend: Handler = null;
  onerror: Handler = null;
  onboundary: Handler = null;
  onpause: Handler = null;
  onresume: Handler = null;
  onmark: Handler = null;
  private listeners = new Map<string, Set<(e: FakeSpeechEvent) => void>>();

  constructor(text = "") {
    this.text = text;
  }

  addEventListener(type: string, fn: (e: FakeSpeechEvent) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (e: FakeSpeechEvent) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  /** Dispatch an event to `on<type>` and to added listeners. */
  dispatch(type: string, init: Partial<FakeSpeechEvent> = {}): void {
    const event: FakeSpeechEvent = {
      type,
      utterance: this,
      charIndex: 0,
      elapsedTime: 0,
      ...init,
    };
    const prop = (this as unknown as Record<string, Handler>)[`on${type}`];
    if (typeof prop === "function") prop.call(this, event);
    for (const fn of Array.from(this.listeners.get(type) ?? [])) fn(event);
  }
}

export interface FakeSpeechOptions {
  /** Fire events on timers instead of waiting for manual triggers. */
  auto?: boolean;
  /** Delay between automatic events (start → each word → end). Default 100 ms. */
  wordIntervalMs?: number;
  /** Voices returned by getVoices(). Default: none. */
  voices?: SpeechSynthesisVoice[];
  /** What a cancelled utterance fires synchronously inside cancel(). Default 'error' ('canceled'). */
  cancelEvent?: "error" | "end" | "none";
  /**
   * Simulate Chrome's long-pause bug: resume() clears the paused flag but the
   * current utterance is silently dropped (no events, speaking = false).
   */
  brokenResume?: boolean;
}

interface Word {
  charIndex: number;
  charLength: number;
}

function wordsOf(text: string): Word[] {
  const words: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    words.push({ charIndex: m.index, charLength: m[0].length });
  }
  return words;
}

export class FakeSpeechSynthesis {
  /** Every utterance passed to speak(), in order. */
  spoken: FakeUtterance[] = [];
  /** Utterances that were current when cancel() was called. */
  cancelled: FakeUtterance[] = [];
  /** Method call log: 'speak' | 'cancel' | 'pause' | 'resume'. */
  calls: string[] = [];
  /** Utterances waiting to start. */
  queue: FakeUtterance[] = [];
  /** The utterance being spoken (or paused). */
  current: FakeUtterance | null = null;
  speaking = false;
  paused = false;
  onvoiceschanged: ((e: Event) => void) | null = null;

  auto: boolean;
  wordIntervalMs: number;
  cancelEvent: "error" | "end" | "none";
  brokenResume: boolean;

  private voices: SpeechSynthesisVoice[];
  private listeners = new Map<string, Set<(e: Event) => void>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private words: Word[] = [];
  private wordPos = 0;
  private started = false;

  constructor(opts: FakeSpeechOptions = {}) {
    this.auto = opts.auto ?? false;
    this.wordIntervalMs = opts.wordIntervalMs ?? 100;
    this.cancelEvent = opts.cancelEvent ?? "error";
    this.brokenResume = opts.brokenResume ?? false;
    this.voices = opts.voices ?? [];
  }

  get pending(): boolean {
    return this.queue.length > 0;
  }

  /** Texts of all spoken utterances. */
  get spokenTexts(): string[] {
    return this.spoken.map((u) => u.text);
  }

  get lastSpoken(): FakeUtterance | undefined {
    return this.spoken[this.spoken.length - 1];
  }

  // --- SpeechSynthesis API ---------------------------------------------------

  speak(u: FakeUtterance): void {
    this.calls.push("speak");
    this.spoken.push(u);
    this.queue.push(u);
    if (!this.current) this.startNext();
  }

  cancel(): void {
    this.calls.push("cancel");
    this.clearTimer();
    this.queue = [];
    const u = this.current;
    this.current = null;
    this.speaking = false;
    if (u) {
      this.cancelled.push(u);
      if (this.cancelEvent === "error") u.dispatch("error", { error: "canceled" });
      else if (this.cancelEvent === "end") u.dispatch("end");
    }
  }

  pause(): void {
    this.calls.push("pause");
    this.paused = true;
    this.clearTimer();
    this.current?.dispatch("pause");
  }

  resume(): void {
    this.calls.push("resume");
    const wasPaused = this.paused;
    this.paused = false;
    if (!wasPaused) return;
    if (this.brokenResume && this.current) {
      this.clearTimer();
      this.current = null;
      this.speaking = false;
      return;
    }
    this.current?.dispatch("resume");
    if (this.current) this.schedule();
    else if (this.queue.length) this.startNext();
  }

  getVoices(): SpeechSynthesisVoice[] {
    return this.voices.slice();
  }

  addEventListener(type: string, fn: (e: Event) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  // --- Test helpers ----------------------------------------------------------

  /** Replace the voice list and fire `voiceschanged`. */
  setVoices(voices: SpeechSynthesisVoice[]): void {
    this.voices = voices.slice();
    const event = { type: "voiceschanged" } as Event;
    this.onvoiceschanged?.(event);
    for (const fn of Array.from(this.listeners.get("voiceschanged") ?? [])) fn(event);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  fireStart(utterance: FakeUtterance | null = this.current): void {
    if (!utterance) return;
    if (utterance === this.current) this.started = true;
    utterance.dispatch("start");
  }

  fireBoundary(
    charIndex: number,
    charLength?: number,
    name = "word",
    utterance: FakeUtterance | null = this.current,
  ): void {
    utterance?.dispatch("boundary", { charIndex, charLength, name });
  }

  /** Fire a boundary for the next word of the current utterance. Returns false if none left. */
  fireWord(): boolean {
    if (!this.current || this.wordPos >= this.words.length) return false;
    if (!this.started) this.fireStart();
    const w = this.words[this.wordPos++];
    this.fireBoundary(w.charIndex, w.charLength);
    return true;
  }

  /**
   * Fire `end`. For the current utterance this also advances the queue; for
   * any other (e.g. cancelled) utterance it only dispatches the stale event.
   */
  fireEnd(utterance: FakeUtterance | null = this.current): void {
    if (!utterance) return;
    if (utterance === this.current) {
      this.clearTimer();
      this.current = null;
      this.speaking = false;
      utterance.dispatch("end");
      if (!this.current) this.startNext();
    } else {
      utterance.dispatch("end");
    }
  }

  /** Alias for fireEnd() on the current utterance. */
  finishCurrent(): void {
    this.fireEnd();
  }

  fireError(error: string, utterance: FakeUtterance | null = this.current): void {
    if (!utterance) return;
    if (utterance === this.current) {
      this.clearTimer();
      this.current = null;
      this.speaking = false;
      utterance.dispatch("error", { error });
      if (!this.current) this.startNext();
    } else {
      utterance.dispatch("error", { error });
    }
  }

  // --- internals -------------------------------------------------------------

  private startNext(): void {
    const next = this.queue.shift() ?? null;
    this.current = next;
    this.speaking = next !== null;
    this.words = next ? wordsOf(next.text) : [];
    this.wordPos = 0;
    this.started = false;
    if (next) this.schedule();
  }

  private schedule(): void {
    if (!this.auto || this.paused || !this.current) return;
    this.clearTimer();
    const u = this.current;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.current !== u || this.paused) return;
      this.step();
    }, this.wordIntervalMs);
  }

  private step(): void {
    const u = this.current;
    if (!u) return;
    if (!this.started) {
      this.fireStart();
    } else if (this.wordPos < this.words.length) {
      this.fireWord();
    } else {
      this.fireEnd();
      return;
    }
    if (this.current === u) this.schedule();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export function fakeVoice(partial: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice {
  const name = partial.name ?? "Fake Voice";
  return {
    name,
    voiceURI: partial.voiceURI ?? `fake:${name}`,
    lang: partial.lang ?? "en-US",
    localService: partial.localService ?? true,
    default: partial.default ?? false,
  } as SpeechSynthesisVoice;
}

export interface FakeSpeech {
  fake: FakeSpeechSynthesis;
  synth: SpeechSynthesis;
  Utterance: typeof SpeechSynthesisUtterance;
}

/** Create a fake synth plus typed values ready for `new SpeechController({ synth, Utterance })`. */
export function createFakeSpeech(opts: FakeSpeechOptions = {}): FakeSpeech {
  const fake = new FakeSpeechSynthesis(opts);
  return {
    fake,
    synth: fake as unknown as SpeechSynthesis,
    Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
  };
}

/**
 * Install a fake as `globalThis.speechSynthesis` / `SpeechSynthesisUtterance`
 * (and on `window` when it exists). Call `restore()` afterwards.
 */
export function installFakeSpeech(
  opts: FakeSpeechOptions = {},
): FakeSpeech & { restore: () => void } {
  const speech = createFakeSpeech(opts);
  const g = globalThis as Record<string, unknown>;
  const targets: Record<string, unknown>[] = [g];
  if (typeof window !== "undefined" && (window as unknown) !== g) {
    targets.push(window as unknown as Record<string, unknown>);
  }
  const saved = targets.map((t) => ({
    t,
    synth: Object.getOwnPropertyDescriptor(t, "speechSynthesis"),
    utt: Object.getOwnPropertyDescriptor(t, "SpeechSynthesisUtterance"),
  }));
  for (const t of targets) {
    Object.defineProperty(t, "speechSynthesis", {
      value: speech.synth,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(t, "SpeechSynthesisUtterance", {
      value: speech.Utterance,
      configurable: true,
      writable: true,
    });
  }
  return {
    ...speech,
    restore: () => {
      for (const { t, synth, utt } of saved) {
        if (synth) Object.defineProperty(t, "speechSynthesis", synth);
        else delete t.speechSynthesis;
        if (utt) Object.defineProperty(t, "SpeechSynthesisUtterance", utt);
        else delete t.SpeechSynthesisUtterance;
      }
    },
  };
}
