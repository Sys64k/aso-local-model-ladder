import { abortError, ImportError, isAbortError, throwIfAborted, whenAborted } from "./errors";

export interface RecognizeOptions {
  /** Tesseract language code, e.g. "eng". */
  lang: string;
  /** Recognition progress from 0 to 1. */
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

/** Images with a longer side than this are scaled down before OCR. */
export const MAX_IMAGE_SIDE = 3000;

type TesseractWorker = {
  recognize(image: Blob): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

/**
 * Downscale very large images (e.g. 12MP phone photos) so OCR stays fast and
 * does not run out of memory. Returns the original Blob when no scaling is
 * needed or the browser cannot decode it here.
 */
async function downscaleIfNeeded(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_IMAGE_SIDE) return file;
    const scale = MAX_IMAGE_SIDE / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    return blob ?? file;
  } finally {
    bitmap.close?.();
  }
}

/**
 * Recognise text in an image with tesseract.js. tesseract.js is loaded on
 * demand (browser only). The worker is always terminated afterwards, also when
 * the operation is aborted.
 */
export async function recognizeImage(
  file: Blob,
  opts: RecognizeOptions,
): Promise<string> {
  const { lang, onProgress, signal } = opts;
  throwIfAborted(signal);

  const mod = await import("tesseract.js");
  const createWorker = (mod.createWorker ??
    (mod as unknown as { default: typeof mod }).default.createWorker) as typeof mod.createWorker;
  throwIfAborted(signal);

  const image = await downscaleIfNeeded(file);
  throwIfAborted(signal);

  let worker: TesseractWorker | null = null;
  let terminated = false;
  const terminate = () => {
    if (!worker || terminated) return;
    terminated = true;
    void worker.terminate().catch(() => {});
  };
  const onAbort = () => terminate();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const creating = createWorker(lang || "eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text" && typeof m.progress === "number") {
          onProgress?.(Math.min(1, Math.max(0, m.progress)));
        }
      },
    }) as unknown as Promise<TesseractWorker>;
    // If we are aborted while the worker is still starting, terminate it once it exists.
    creating.then(
      (w) => {
        worker = w;
        if (signal?.aborted) terminate();
      },
      () => {},
    );
    worker = await Promise.race([creating, whenAborted(signal)]);
    throwIfAborted(signal);

    const result = await Promise.race([worker.recognize(image), whenAborted(signal)]);
    throwIfAborted(signal);
    onProgress?.(1);
    return result.data.text ?? "";
  } catch (err) {
    if (signal?.aborted) throw isAbortError(err) ? err : abortError();
    throw new ImportError("ocr_failed", err instanceof Error ? err.message : String(err));
  } finally {
    signal?.removeEventListener("abort", onAbort);
    terminate();
  }
}
