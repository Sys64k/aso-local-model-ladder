import { abortError, ImportError, isAbortError, throwIfAborted, whenAborted } from "./errors";

export interface PdfOptions {
  /** Called after each page: `page` is 1-based. */
  onProgress?: (page: number, total: number) => void;
  signal?: AbortSignal;
}

/** Minimal shape of a pdf.js text item that we use. */
export interface PdfTextItem {
  str: string;
  transform: number[];
  height: number;
  hasEOL?: boolean;
}

/** A vertical gap larger than this many line heights starts a new paragraph. */
const PARAGRAPH_GAP = 1.6;
/** A vertical move larger than this many line heights is a new line. */
const LINE_GAP = 0.5;

/**
 * Join the text items of one page. Items on the same line are concatenated,
 * new lines become "\n" and large vertical gaps become "\n\n".
 */
export function joinTextItems(items: ReadonlyArray<unknown>): string {
  let out = "";
  let prevY: number | null = null;
  let prevH = 0;
  let pendingEOL = false;

  for (const raw of items) {
    if (!raw || typeof raw !== "object" || typeof (raw as PdfTextItem).str !== "string") {
      continue; // marked content
    }
    const item = raw as PdfTextItem;
    if (!item.str) {
      if (item.hasEOL) pendingEOL = true;
      continue;
    }
    const y = Number(item.transform?.[5]) || 0;
    const h =
      Math.abs(item.height) || Math.abs(Number(item.transform?.[3]) || 0) || prevH || 10;

    if (prevY !== null) {
      const lineH = Math.max(h, prevH);
      const gap = Math.abs(prevY - y);
      if (gap > lineH * PARAGRAPH_GAP) out += "\n\n";
      else if (pendingEOL || gap > lineH * LINE_GAP) out += "\n";
    }
    out += item.str;
    prevY = y;
    prevH = h;
    pendingEOL = !!item.hasEOL;
  }
  return out;
}

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

/**
 * Extract the text layer of a PDF with pdf.js (loaded on demand, browser only).
 * Pages are separated by "\n\n". Throws an ImportError with code
 * 'no_text_layer' when the PDF contains no text (e.g. a scanned document).
 */
export async function extractPdfText(file: Blob, opts: PdfOptions = {}): Promise<string> {
  const { onProgress, signal } = opts;
  throwIfAborted(signal);
  const pdfjs = await loadPdfJs();
  throwIfAborted(signal);
  const data = new Uint8Array(await file.arrayBuffer());
  throwIfAborted(signal);

  const task = pdfjs.getDocument({ data });
  const onAbort = () => {
    void task.destroy().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const doc = await Promise.race([task.promise, whenAborted(signal)]);
    const total = doc.numPages;
    const pages: string[] = [];
    for (let n = 1; n <= total; n++) {
      throwIfAborted(signal);
      const page = await Promise.race([doc.getPage(n), whenAborted(signal)]);
      const content = await Promise.race([page.getTextContent(), whenAborted(signal)]);
      pages.push(joinTextItems(content.items).trim());
      page.cleanup();
      onProgress?.(n, total);
    }
    const text = pages.filter(Boolean).join("\n\n");
    if (!text.trim()) throw new ImportError("no_text_layer", "The PDF has no text layer.");
    return text;
  } catch (err) {
    if (signal?.aborted) throw isAbortError(err) ? err : abortError();
    if (err instanceof ImportError) throw err;
    throw new ImportError("pdf_failed", err instanceof Error ? err.message : String(err));
  } finally {
    signal?.removeEventListener("abort", onAbort);
    void task.destroy().catch(() => {});
  }
}
