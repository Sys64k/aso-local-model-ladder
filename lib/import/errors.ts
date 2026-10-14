export type ImportErrorCode = "no_text_layer" | "pdf_failed" | "ocr_failed";

/** Error with a machine-readable `code` the UI can turn into a friendly message. */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ImportError";
    this.code = code;
  }
}

export function abortError(): Error {
  try {
    return new DOMException("The operation was aborted.", "AbortError");
  } catch {
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    return err;
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** A promise that rejects with an AbortError once `signal` aborts (never settles otherwise). */
export function whenAborted(signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}
