import { test as base, expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared Playwright fixtures.
 *
 * Every page gets a deterministic fake `window.speechSynthesis` and
 * `SpeechSynthesisUtterance` (installed with `page.addInitScript`, so it is in
 * place before any app code runs and survives reloads). For each utterance the
 * fake fires `start`, one `boundary` event (name "word") per word, then `end`,
 * one event every `speechWordIntervalMs` (default 30 ms). It supports
 * pause/resume/cancel, returns two fake voices from getVoices() and records
 * every spoken text in `window.__spoken`. No real audio is ever produced.
 */

export interface FakeSpeechConfig {
  wordIntervalMs: number;
}

declare global {
  interface Window {
    /** Texts passed to speechSynthesis.speak(), in order. */
    __spoken: string[];
  }
}

export const FAKE_VOICES = [
  { name: "Fake English", lang: "en-US", voiceURI: "fake-en-US", default: true, localService: true },
  { name: "Fake Spanish", lang: "es-ES", voiceURI: "fake-es-ES", default: false, localService: true },
] as const;

/**
 * Runs in the browser. Must be self-contained: it is serialised by
 * page.addInitScript and cannot reference anything from this module.
 */
function installFakeSpeech(config: FakeSpeechConfig & { voices: readonly object[] }): void {
  type Handler = ((event: object) => void) | null;
  type Listeners = Record<string, Array<(event: object) => void>>;

  const interval = Math.max(1, config.wordIntervalMs);
  const spoken: string[] = [];
  window.__spoken = spoken;

  function addListener(map: Listeners, type: string, fn: unknown) {
    if (typeof fn !== "function") return;
    (map[type] ||= []).push(fn as (event: object) => void);
  }
  function removeListener(map: Listeners, type: string, fn: unknown) {
    const list = map[type];
    if (!list) return;
    const i = list.indexOf(fn as (event: object) => void);
    if (i >= 0) list.splice(i, 1);
  }

  class FakeUtterance {
    text: string;
    lang: string;
    voice: unknown;
    rate: number;
    pitch: number;
    volume: number;
    onstart: Handler;
    onend: Handler;
    onerror: Handler;
    onboundary: Handler;
    onpause: Handler;
    onresume: Handler;
    onmark: Handler;
    _listeners: Listeners;

    constructor(text?: string) {
      this.text = text == null ? "" : String(text);
      this.lang = "";
      this.voice = null;
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
      this.onboundary = null;
      this.onpause = null;
      this.onresume = null;
      this.onmark = null;
      this._listeners = {};
    }

    addEventListener(type: string, fn: unknown) {
      addListener(this._listeners, type, fn);
    }

    removeEventListener(type: string, fn: unknown) {
      removeListener(this._listeners, type, fn);
    }

    _fire(type: string, extra: Record<string, unknown> = {}) {
      const event = {
        type,
        target: this,
        utterance: this,
        charIndex: 0,
        charLength: 0,
        elapsedTime: 0,
        name: "",
        ...extra,
      };
      const prop = (this as unknown as Record<string, Handler>)[`on${type}`];
      if (typeof prop === "function") prop.call(this, event);
      for (const fn of (this._listeners[type] || []).slice()) fn.call(this, event);
    }
  }

  const s = {
    queue: [] as FakeUtterance[],
    current: null as FakeUtterance | null,
    words: [] as { index: number; length: number }[],
    pos: 0,
    started: false,
    paused: false,
    timer: null as ReturnType<typeof setTimeout> | null,
    startedAt: 0,
  };
  const synthListeners: Listeners = {};

  function clearTimer() {
    if (s.timer !== null) {
      clearTimeout(s.timer);
      s.timer = null;
    }
  }

  function wordsOf(text: string) {
    const out: { index: number; length: number }[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push({ index: m.index, length: m[0].length });
    return out;
  }

  function schedule() {
    clearTimer();
    if (s.paused || !s.current) return;
    const u = s.current;
    s.timer = setTimeout(() => {
      s.timer = null;
      if (s.current !== u || s.paused) return;
      step();
    }, interval);
  }

  function startNext() {
    const next = s.queue.shift() || null;
    s.current = next;
    s.words = next ? wordsOf(next.text) : [];
    s.pos = 0;
    s.started = false;
    if (next) schedule();
  }

  function step() {
    const u = s.current;
    if (!u) return;
    const elapsedTime = Date.now() - s.startedAt;
    if (!s.started) {
      s.started = true;
      s.startedAt = Date.now();
      u._fire("start");
    } else if (s.pos < s.words.length) {
      const w = s.words[s.pos++];
      u._fire("boundary", { name: "word", charIndex: w.index, charLength: w.length, elapsedTime });
    } else {
      s.current = null;
      u._fire("end", { charIndex: u.text.length, elapsedTime });
      if (!s.current) startNext();
      return;
    }
    if (s.current === u) schedule();
  }

  const synth = {
    onvoiceschanged: null as Handler,
    get speaking() {
      return s.current !== null;
    },
    get paused() {
      return s.paused;
    },
    get pending() {
      return s.queue.length > 0;
    },
    speak(u: FakeUtterance) {
      spoken.push(u.text);
      s.queue.push(u);
      if (!s.current) startNext();
    },
    cancel() {
      clearTimer();
      const u = s.current;
      const dropped = s.queue;
      s.queue = [];
      s.current = null;
      if (u) u._fire("error", { error: "interrupted" });
      for (const q of dropped) q._fire("error", { error: "canceled" });
    },
    pause() {
      if (s.paused) return;
      s.paused = true;
      clearTimer();
      s.current?._fire("pause");
    },
    resume() {
      if (!s.paused) return;
      s.paused = false;
      if (s.current) {
        s.current._fire("resume");
        schedule();
      } else if (s.queue.length) {
        startNext();
      }
    },
    getVoices() {
      return config.voices.slice();
    },
    addEventListener(type: string, fn: unknown) {
      addListener(synthListeners, type, fn);
    },
    removeEventListener(type: string, fn: unknown) {
      removeListener(synthListeners, type, fn);
    },
    dispatchEvent(event: { type: string }) {
      const prop = (synth as unknown as Record<string, Handler>)[`on${event.type}`];
      if (typeof prop === "function") prop.call(synth, event);
      for (const fn of (synthListeners[event.type] || []).slice()) fn.call(synth, event);
      return true;
    },
  };

  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    get: () => synth,
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    writable: true,
    value: FakeUtterance,
  });
  // Like real browsers, announce the voice list asynchronously as well.
  setTimeout(() => synth.dispatchEvent({ type: "voiceschanged" }), 0);
}

export const test = base.extend<{ speechWordIntervalMs: number }>({
  speechWordIntervalMs: [30, { option: true }],
  // (Playwright's fixture callback is conventionally called `use`; it is named
  // `provide` here so the React hooks lint rule does not mistake it for a hook.)
  page: async ({ page, speechWordIntervalMs }, provide) => {
    await page.addInitScript(installFakeSpeech, {
      wordIntervalMs: speechWordIntervalMs,
      voices: FAKE_VOICES,
    });
    await provide(page);
  },
});

export { expect };

// --- helpers ------------------------------------------------------------------

/** Texts the fake speech engine was asked to speak, in order. */
export function spokenTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__spoken.slice());
}

/** The sentence span with the given index. */
export function sentence(page: Page, index: number): Locator {
  return page.locator(`[data-sentence-index="${index}"]`);
}

/** The sentence currently marked as being read. */
export function currentSentence(page: Page): Locator {
  return page.locator('[data-sentence-index][aria-current="true"]');
}

/** The app's polite status announcer (visually hidden live region). */
export function announcer(page: Page): Locator {
  return page.locator("#announcer");
}

/**
 * Wait until React has hydrated the page (interactive elements carry React's
 * internal props). Keyboard input or clicks before that would be lost or, for
 * forms, trigger a native submit.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.querySelector("header button");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
  });
}

/** Open Home and wait until the app is interactive. */
export async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
  await waitForHydration(page);
}

/** From Home: paste `text` in the "Paste text" tab and open it in the reader. */
export async function pasteAndRead(page: Page, text: string): Promise<void> {
  await page.getByRole("tab", { name: "Paste text" }).click();
  await page.getByRole("textbox", { name: "Text to read" }).fill(text);
  await page.getByRole("button", { name: "Read this text" }).click();
  await expect(page.getByRole("button", { name: "New document" })).toBeVisible();
}
