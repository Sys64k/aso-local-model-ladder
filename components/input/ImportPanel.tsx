"use client";

import {
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { deriveTitle, type DocumentSource } from "@/lib/documents";
import { isAbortError } from "@/lib/import/errors";
import { recognizeImage } from "@/lib/import/ocr";
import { extractPdfText } from "@/lib/import/pdf";
import { detectKind, readAsText, titleFromFileName } from "@/lib/import/readFile";
import { normalizeText } from "@/lib/text/segment";
import type { ImportedText } from "./types";

export const TABS = [
  { key: "paste", label: "Paste text" },
  { key: "file", label: "Upload file" },
  { key: "photo", label: "Take photo" },
  { key: "url", label: "Web page" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export const OCR_LANGUAGES = [
  { code: "eng", label: "English" },
  { code: "spa", label: "Spanish" },
  { code: "fra", label: "French" },
  { code: "deu", label: "German" },
  { code: "por", label: "Portuguese" },
  { code: "ita", label: "Italian" },
] as const;

export type UrlErrorCode =
  | "invalid_url"
  | "blocked_host"
  | "too_large"
  | "unsupported_content"
  | "no_content"
  | "fetch_failed";

export const URL_ERROR_MESSAGES: Record<UrlErrorCode, string> = {
  invalid_url:
    "That doesn't look like a web page address. Check it and try again, for example https://example.com/article.",
  blocked_host:
    "That address can't be opened for safety reasons. Please try a public web page.",
  too_large:
    "That page is too big to read here. Try another page, or copy and paste the text instead.",
  unsupported_content:
    "That address is not a web page with readable text (it may be a file or a video). Try an article page instead.",
  no_content:
    "We couldn't find any readable text on that page. Try copying and pasting the text instead.",
  fetch_failed:
    "We couldn't get that page. Check the address and try again in a moment.",
};

export const MESSAGES = {
  emptyPaste: "Please paste or type some text first.",
  emptyUrl: "Please enter a web page address.",
  network: "We couldn't connect. Check your internet connection and try again.",
  unsupportedFile:
    "That type of file isn't supported. Choose a text file (.txt or .md), a PDF or an image.",
  notAnImage: "That file is not an image. Please take a photo or choose an image.",
  emptyFile: "That file doesn't contain any text to read.",
  emptyImage:
    "We couldn't find any text in that image. Try a sharper photo with good lighting.",
  ocrFailed: "Reading the image didn't work. Please try again or use a clearer image.",
  noTextLayer:
    "This PDF is a scanned image without selectable text. Take a photo of the page or upload it as an image instead.",
  pdfFailed:
    "We couldn't open that PDF. It may be damaged or password-protected.",
  fileFailed: "We couldn't read that file. Please try again.",
} as const;

type BusyKind = "file" | "pdf" | "ocr" | "url";

/** An error whose message can be shown to the user as-is. */
class UserError extends Error {}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function isUrlErrorCode(v: unknown): v is UrlErrorCode {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(URL_ERROR_MESSAGES, v);
}

const CONTROL =
  "min-h-12 rounded-lg border-2 border-current px-4 py-2 text-lg disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BUTTON =
  "min-h-12 rounded-lg border-2 border-accent bg-accent px-6 py-2 text-lg font-bold text-accent-fg hover:underline disabled:cursor-not-allowed disabled:opacity-50";
const LABEL = "block text-lg font-bold";

export function ImportPanel({ onImport }: { onImport: (doc: ImportedText) => void }) {
  const uid = useId();
  const id = (part: string) => `${uid}-${part}`;

  const [active, setActive] = useState(0);
  const [pasteText, setPasteText] = useState("");
  const [url, setUrl] = useState("");
  const [lang, setLang] = useState<string>("eng");
  const [busy, setBusy] = useState<BusyKind | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [stats, setStats] = useState<{
    words: number;
    sentences: number;
    paragraphs: number;
    minutes: number;
  } | null>(null);

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const lastBucketRef = useRef(-1);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const statsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Abort any running work when the panel goes away.
  useEffect(() => {
    const runIds = runIdRef;
    const aborts = abortRef;
    return () => {
      runIds.current++;
      aborts.current?.abort();
      if (statsTimeoutRef.current) {
        clearTimeout(statsTimeoutRef.current);
      }
    };
  }, []);

  // Keep keyboard focus somewhere sensible while controls are disabled.
  useEffect(() => {
    if (busy === "ocr" || busy === "pdf") {
      cancelRef.current?.focus();
      return;
    }
    if (busy === null && restoreFocusRef.current) {
      const el = restoreFocusRef.current;
      restoreFocusRef.current = null;
      const current = document.activeElement;
      if (
        (!current || current === document.body) &&
        el.isConnected &&
        !el.closest("[hidden]")
      ) {
        el.focus();
      }
    }
  }, [busy]);

  /** Announce progress at most once per 10%. */
  const announceProgress = useCallback((fraction: number, message: (pct: number) => string) => {
    const f = Math.min(1, Math.max(0, fraction));
    setProgress(f);
    const bucket = Math.floor(f * 10);
    if (bucket <= lastBucketRef.current) return;
    lastBucketRef.current = bucket;
    setStatus(message(bucket * 10));
  }, []);

  const finish = useCallback(
    (raw: string, title: string, source: DocumentSource, emptyMessage: string): ImportedText => {
      const text = normalizeText(raw ?? "");
      if (!text) throw new UserError(emptyMessage);
      return { title: title.trim() || deriveTitle(text), text, source };
    },
    [],
  );

  const fetchStats = useCallback((text: string) => {
    // Cancel any pending stats requests
    if (statsTimeoutRef.current) {
      clearTimeout(statsTimeoutRef.current);
      statsTimeoutRef.current = null;
    }

    // Only fetch for text that is at least 20 characters after trimming
    const trimmedText = text.trim();
    if (trimmedText.length < 20) {
      setStats(null);
      return;
    }

    // Debounce the request to avoid too frequent calls
    statsTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/stats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (!res.ok) {
          // If request fails, clear stats
          setStats(null);
          return;
        }

        const data = await res.json();
        
        // Validate the response structure
        if (typeof data.words === 'number' && 
            typeof data.sentences === 'number' && 
            typeof data.paragraphs === 'number' && 
            typeof data.minutes === 'number') {
          setStats(data);
        } else {
          // Invalid data, clear stats
          setStats(null);
        }
      } catch (err) {
        // If request fails, clear stats  
        setStats(null);
      }
    }, 500); // Debounce for 500ms
  }, []);

  const run = useCallback(
    async (kind: BusyKind, work: (signal: AbortSignal) => Promise<ImportedText>) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const runId = ++runIdRef.current;
      const focused = typeof document !== "undefined" ? document.activeElement : null;
      restoreFocusRef.current = focused instanceof HTMLElement ? focused : null;
      lastBucketRef.current = -1;
      setError("");
      setProgress(null);
      setBusy(kind);
      try {
        const doc = await work(controller.signal);
        if (runId !== runIdRef.current) return;
        setStatus("Text ready");
        onImport(doc);
      } catch (err) {
        if (runId !== runIdRef.current) return;
        if (controller.signal.aborted || isAbortError(err)) {
          setStatus("Cancelled");
          return;
        }
        setStatus("");
        if (err instanceof UserError) {
          setError(err.message);
        } else if (kind === "pdf") {
          setError(errorCode(err) === "no_text_layer" ? MESSAGES.noTextLayer : MESSAGES.pdfFailed);
        } else if (kind === "ocr") {
          setError(MESSAGES.ocrFailed);
        } else if (kind === "url") {
          setError(MESSAGES.network);
        } else {
          setError(MESSAGES.fileFailed);
        }
      } finally {
        if (runId === runIdRef.current) {
          abortRef.current = null;
          setBusy(null);
          setProgress(null);
        }
      }
    },
    [onImport],
  );

  const cancel = () => {
    runIdRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(null);
    setProgress(null);
    setStatus("Cancelled");
  };

  const handleFile = (file: File, via: "file" | "photo") => {
    const kind = detectKind(file);
    if (via === "photo" && kind !== "image") {
      setStatus("");
      setError(MESSAGES.notAnImage);
      return;
    }
    const fileTitle = via === "photo" ? "" : titleFromFileName(file.name);

    if (kind === "text") {
      setStatus("Reading file…");
      void run("file", async () =>
        finish(await readAsText(file), fileTitle, "file", MESSAGES.emptyFile),
      );
    } else if (kind === "pdf") {
      setStatus("Opening PDF…");
      void run("pdf", async (signal) => {
        const raw = await extractPdfText(file, {
          signal,
          onProgress: (page, total) => {
            if (signal.aborted || total <= 0) return;
            announceProgress(page / total, () => `Extracting PDF page ${page} of ${total}`);
          },
        });
        return finish(raw, fileTitle, "pdf", MESSAGES.noTextLayer);
      });
    } else if (kind === "image") {
      setStatus("Reading image…");
      void run("ocr", async (signal) => {
        // "Reading image…" was just announced; the next announcement is at 10%.
        lastBucketRef.current = 0;
        const raw = await recognizeImage(file, {
          lang,
          signal,
          onProgress: (p) => {
            if (signal.aborted) return;
            announceProgress(p, (pct) => `Reading image… ${pct}%`);
          },
        });
        return finish(raw, fileTitle, "image", MESSAGES.emptyImage);
      });
    } else {
      setStatus("");
      setError(MESSAGES.unsupportedFile);
    }
  };

  const onPasteSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const text = normalizeText(pasteText);
    if (!text) {
      setStatus("");
      setError(MESSAGES.emptyPaste);
      textareaRef.current?.focus();
      return;
    }
    setError("");
    setStatus("Text ready");
    onImport({ title: deriveTitle(text), text, source: "paste" });
  };

  const onUrlSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    let address = url.trim();
    if (!address) {
      setStatus("");
      setError(MESSAGES.emptyUrl);
      urlInputRef.current?.focus();
      return;
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(address)) address = `https://${address}`;
    setStatus("Fetching page…");
    void run("url", async (signal) => {
      let res: Response;
      try {
        res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: address }),
          signal,
        });
      } catch (err) {
        if (signal.aborted || isAbortError(err)) throw err;
        throw new UserError(MESSAGES.network);
      }
      let body: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = await res.json();
        if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
      } catch {
        body = null;
      }
      if (!res.ok || !body || typeof body.text !== "string") {
        const code = body?.error;
        throw new UserError(
          isUrlErrorCode(code) ? URL_ERROR_MESSAGES[code] : URL_ERROR_MESSAGES.fetch_failed,
        );
      }
      const title = typeof body.title === "string" ? body.title : "";
      return finish(body.text, title, "url", URL_ERROR_MESSAGES.no_content);
    });
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    switch (e.key) {
      case "ArrowRight":
        next = (index + 1) % TABS.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + TABS.length) % TABS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = TABS.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const onDragOver = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = busy ? "none" : "copy";
    if (!busy) setDragOver(true);
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file, "file");
  };

  const activeKey: TabKey = TABS[active].key;
  const isBusy = busy !== null;
  const canCancel = busy === "ocr" || busy === "pdf";

  const languageSelect = (
    <div className="space-y-2">
      <label htmlFor={id("lang")} className={LABEL}>
        Text language
      </label>
      <select
        id={id("lang")}
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        aria-describedby={id("lang-hint")}
        className={`${CONTROL} bg-transparent`}
      >
        {OCR_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <p id={id("lang-hint")} className="text-lg">
        Used when reading text from images and photos.
      </p>
    </div>
  );

  return (
    <div className="space-y-4 text-lg">
      <section aria-label="Add text to read" aria-busy={isBusy} className="space-y-4">
        <div role="tablist" aria-label="How to add text" className="flex flex-wrap gap-2">
          {TABS.map((tab, i) => {
            const selected = i === active;
            return (
              <button
                key={tab.key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={id(`tab-${tab.key}`)}
                aria-selected={selected}
                aria-controls={id(`panel-${tab.key}`)}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(i)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={`min-h-12 rounded-t-lg border-b-4 px-4 py-2 text-lg ${
                  selected ? "border-current font-bold" : "border-transparent opacity-80"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <fieldset disabled={isBusy} className="min-w-0">
          <legend className="sr-only">{TABS[active].label}</legend>

          <div
            role="tabpanel"
            id={id("panel-paste")}
            aria-labelledby={id("tab-paste")}
            hidden={activeKey !== "paste"}
          >
            <form onSubmit={onPasteSubmit} className="space-y-3">
              <label htmlFor={id("paste")} className={LABEL}>
                Text to read
              </label>
              <textarea
                id={id("paste")}
                ref={textareaRef}
                value={pasteText}
                onChange={(e) => {
                  setPasteText(e.target.value);
                  fetchStats(e.target.value);
                }}
                rows={8}
                className="block min-h-48 w-full rounded-lg border-2 border-current bg-transparent p-3 text-lg"
              />
              {stats && (
                <div className="mt-2 text-lg">
                  <span className="mr-4">Words: {stats.words}</span>
                  <span className="mr-4">Sentences: {stats.sentences}</span>
                  <span className="mr-4">Paragraphs: {stats.paragraphs}</span>
                  <span>Reading time: {stats.minutes} min</span>
                </div>
              )}
              <button type="submit" className={PRIMARY_BUTTON}>
                Read this text
              </button>
            </form>
          </div>

          <div
            role="tabpanel"
            id={id("panel-file")}
            aria-labelledby={id("tab-file")}
            hidden={activeKey !== "file"}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label htmlFor={id("file")} className={LABEL}>
                Choose a file
              </label>
              <input
                id={id("file")}
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.pdf,image/*"
                aria-describedby={id("file-hint")}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) handleFile(file, "file");
                }}
                className="block min-h-12 w-full text-lg file:mr-4 file:min-h-12 file:rounded-lg file:border-2 file:border-current file:bg-transparent file:px-4 file:text-lg"
              />
              <p id={id("file-hint")} className="text-lg">
                Text files (.txt, .md), PDF documents and images of text.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={onDragOver}
              onDragEnter={onDragOver}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`flex min-h-32 w-full items-center justify-center rounded-lg border-4 border-dashed p-6 text-center text-lg ${
                dragOver ? "border-blue-700 bg-blue-50 text-blue-900" : "border-current"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              Drop a file here, or press to choose a file
            </button>
            {activeKey === "file" && languageSelect}
          </div>

          <div
            role="tabpanel"
            id={id("panel-photo")}
            aria-labelledby={id("tab-photo")}
            hidden={activeKey !== "photo"}
            className="space-y-4"
          >
            <p id={id("photo-tip")} className="text-lg">
              Hold the camera steady, use good lighting, and fill the frame with the page.
            </p>
            {activeKey === "photo" && languageSelect}
            <div className="space-y-2">
              <label htmlFor={id("photo")} className={LABEL}>
                Take a photo of text
              </label>
              <input
                id={id("photo")}
                type="file"
                accept="image/*"
                capture="environment"
                aria-describedby={id("photo-tip")}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) handleFile(file, "photo");
                }}
                className="block min-h-12 w-full text-lg file:mr-4 file:min-h-12 file:rounded-lg file:border-2 file:border-current file:bg-transparent file:px-4 file:text-lg"
              />
            </div>
          </div>

          <div
            role="tabpanel"
            id={id("panel-url")}
            aria-labelledby={id("tab-url")}
            hidden={activeKey !== "url"}
          >
            <form onSubmit={onUrlSubmit} noValidate className="space-y-3">
              <label htmlFor={id("url")} className={LABEL}>
                Web page address
              </label>
              <input
                id={id("url")}
                ref={urlInputRef}
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={`${CONTROL} block w-full bg-transparent`}
              />
              <button type="submit" className={PRIMARY_BUTTON}>
                Get text
              </button>
            </form>
          </div>
        </fieldset>
      </section>

      <div className="space-y-3">
        <p role="status" aria-live="polite" aria-atomic="true" className="min-h-7 text-lg">
          {status}
        </p>
        {isBusy && progress !== null && (
          <progress
            aria-hidden="true"
            value={progress}
            max={1}
            className="block h-3 w-full"
          />
        )}
        {canCancel && (
          <button type="button" ref={cancelRef} onClick={cancel} className={CONTROL}>
            Cancel
          </button>
        )}
        <div
          role="alert"
          className={
            error
              ? "rounded-lg border-2 border-red-700 bg-red-50 p-3 text-lg text-red-900"
              : undefined
          }
        >
          {error}
        </div>
      </div>
    </div>
  );
}
