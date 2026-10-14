import { getDefaultStorage } from "./storage";
import { splitSentences } from "./text/segment";

export type DocumentSource = "paste" | "file" | "pdf" | "image" | "url";

export interface SavedDocument {
  id: string;
  title: string;
  text: string;
  source: DocumentSource;
  createdAt: number;
  updatedAt: number;
  lastSentenceIndex: number;
}

export const DOCUMENTS_STORAGE_KEY = "readaloud:documents:v1";
export const MAX_DOCUMENTS = 20;
export const TITLE_MAX_LENGTH = 60;

const SOURCES: readonly DocumentSource[] = ["paste", "file", "pdf", "image", "url"];

function isDocument(v: unknown): v is SavedDocument {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.title === "string" &&
    typeof d.text === "string" &&
    typeof d.source === "string" &&
    (SOURCES as readonly string[]).includes(d.source) &&
    typeof d.createdAt === "number" &&
    typeof d.updatedAt === "number" &&
    typeof d.lastSentenceIndex === "number"
  );
}

function sortNewestFirst(docs: SavedDocument[]): SavedDocument[] {
  // Array#sort is stable, so equal timestamps keep their stored order.
  return docs.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

function read(storage: Storage | null): SavedDocument[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(DOCUMENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isDocument) : [];
  } catch {
    return [];
  }
}

function write(storage: Storage | null, docs: SavedDocument[]): void {
  if (!storage) return;
  try {
    storage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(docs));
  } catch {
    // Quota exceeded / private mode: keep going without persistence.
  }
}

function resolve(storage?: Storage | null): Storage | null {
  return storage ?? getDefaultStorage();
}

function newId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // fall through
  }
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** All saved documents, most recently updated first. */
export function listDocuments(storage?: Storage | null): SavedDocument[] {
  return sortNewestFirst(read(resolve(storage)));
}

/**
 * Save a document. If a document with the same text exists it is updated
 * (title, source, updatedAt) instead of duplicated. At most 20 documents are
 * kept; the oldest are dropped.
 */
export function saveDocument(
  input: { title: string; text: string; source: DocumentSource },
  storage?: Storage | null,
): SavedDocument {
  const store = resolve(storage);
  const docs = listDocuments(store);
  const now = Date.now();
  const title = input.title?.trim() || deriveTitle(input.text);
  const existing = docs.find((d) => d.text === input.text);
  let doc: SavedDocument;
  if (existing) {
    doc = { ...existing, title, source: input.source, updatedAt: now };
  } else {
    doc = {
      id: newId(),
      title,
      text: input.text,
      source: input.source,
      createdAt: now,
      updatedAt: now,
      lastSentenceIndex: 0,
    };
  }
  const rest = docs.filter((d) => d.id !== doc.id);
  write(store, sortNewestFirst([doc, ...rest]).slice(0, MAX_DOCUMENTS));
  return doc;
}

export function getDocument(id: string, storage?: Storage | null): SavedDocument | null {
  return read(resolve(storage)).find((d) => d.id === id) ?? null;
}

/** Remember the reading position. Also marks the document as recently used. */
export function updateProgress(
  id: string,
  lastSentenceIndex: number,
  storage?: Storage | null,
): void {
  const store = resolve(storage);
  const docs = listDocuments(store);
  const doc = docs.find((d) => d.id === id);
  if (!doc) return;
  const index = Number.isFinite(lastSentenceIndex)
    ? Math.max(0, Math.floor(lastSentenceIndex))
    : 0;
  const updated = { ...doc, lastSentenceIndex: index, updatedAt: Date.now() };
  write(
    store,
    sortNewestFirst([updated, ...docs.filter((d) => d.id !== id)]),
  );
}

export function deleteDocument(id: string, storage?: Storage | null): void {
  const store = resolve(storage);
  const docs = read(store);
  const rest = docs.filter((d) => d.id !== id);
  if (rest.length !== docs.length) write(store, rest);
}

/** First ~60 chars of the first sentence, cut at a word boundary, with an ellipsis. */
export function deriveTitle(text: string): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "Untitled";
  // Only look at the beginning; splitting a whole book just for the title is wasteful.
  const first = splitSentences(clean.slice(0, 500))[0]?.text ?? clean;
  if (first.length <= TITLE_MAX_LENGTH) return first;
  const slice = first.slice(0, TITLE_MAX_LENGTH + 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : first.slice(0, TITLE_MAX_LENGTH);
  return `${cut.replace(/[\s,;:.\-–—]+$/, "")}…`;
}
