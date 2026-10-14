export type FileKind = "text" | "pdf" | "image" | "unsupported";

const TEXT_MIME = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const TEXT_EXT = new Set(["txt", "text", "md", "markdown"]);
const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "tif",
  "tiff",
  "pbm",
  "pgm",
  "ppm",
]);

function extensionOf(name: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** What kind of import a file is: by MIME type first, then by file extension. */
export function detectKind(file: File): FileKind {
  const type = (file.type ?? "").toLowerCase().split(";")[0].trim();
  if (TEXT_MIME.has(type)) return "text";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";

  const ext = extensionOf(file.name);
  if (TEXT_EXT.has(ext)) return "text";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXT.has(ext)) return "image";
  return "unsupported";
}

/** File name without its directory and extension ("Notes.v2.txt" → "Notes.v2"). */
export function titleFromFileName(name: string): string {
  const base = ((name ?? "").split(/[\\/]/).pop() ?? "").trim();
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).trim();
}

/** Read a Blob as UTF-8 text (uses Blob#text, falls back to FileReader). */
export function readAsText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsText(file);
  });
}
