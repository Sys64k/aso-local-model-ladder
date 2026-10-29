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
  /** Free-text note. Older stored documents without a note read as "". */
  note: string;
}

export const DOCUMENTS_STORAGE_KEY = "readaloud:documents:v1";
export const MAX_DOCUMENTS = 20;
export const TITLE_MAX_LENGTH = 60;
export const NOTE_MAX_LENGTH = 10_000;
export const NOTE_PREVIEW_LENGTH = 80;

const SOURCES: readonly DocumentSource[] = ["paste", "file", "pdf", "image", "url"];

/** Validates the stored shape; `note` is optional so older v1 data stays valid. */
function isDocument(v: unknown): v is Omit<SavedDocument, "note"> & { note?: unknown } {
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
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isDocument)
      .map((d) => ({ ...d, note: typeof d.note === "string" ? d.note : "" }));
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
 * Search saved documents for a query string.
 * Returns documents where the query (case‑insensitive, literal substring)
 * appears in the title, or in the text, or in the note.
 *
 * Title matches are grouped first, newest first by updatedAt.
 * Text/note matches are grouped after, also newest first.
 * Each document appears at most once; if it matches the title it is included only
 * in the title group.
 *
 * Whitespace‑only or empty queries return all documents ordered newest first.
 * Errors reading storage return an empty array and do not throw.
 */
export function searchDocuments(query: string, storage?: Storage | null): SavedDocument[] {
  const store = resolve(storage);
  const docs = read(store);
  // If no documents, return empty quickly.
  if (!docs.length) return [];
  const trimmed = query?.trim() ?? "";
  if (!trimmed) return sortNewestFirst(docs);

  const qLower = trimmed.toLowerCase();
  const titleMatches: SavedDocument[] = [];
  const otherMatches: SavedDocument[] = [];

  for (const d of docs) {
    const titleMatch = d.title.toLowerCase().includes(qLower);
    const textMatch = d.text.toLowerCase().includes(qLower);
    const noteMatch = d.note.toLowerCase().includes(qLower);
    if (titleMatch) {
      titleMatches.push(d);
    } else if (textMatch || noteMatch) {
      otherMatches.push(d);
    }
  }

  titleMatches.sort((a, b) => b.updatedAt - a.updatedAt);
  otherMatches.sort((a, b) => b.updatedAt - a.updatedAt);

  return [...titleMatches, ...otherMatches];
}

function tidyTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean;
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
  
  // Tidy the title: trim, collapse whitespace, and cut if too long
  let title = input.title;
  if (title) {
    // Collapse whitespace and trim, then check if it's only whitespace 
    const cleanTitle = tidyTitle(title);
    if (!cleanTitle) {
      // If title is only whitespace, fallback to derived title
      title = deriveTitle(input.text);
    } else {
      // Check length and truncate like deriveTitle does
      if (cleanTitle.length > TITLE_MAX_LENGTH) {
        const slice = cleanTitle.slice(0, TITLE_MAX_LENGTH + 1);
        const lastSpace = slice.lastIndexOf(" ");
        const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : cleanTitle.slice(0, TITLE_MAX_LENGTH);
        title = `${cut.replace(/[\s,;:.\-–—]+$/, "")}…`;
      } else {
        title = cleanTitle;
      }
    }
  } else {
    // If no title given at all, derive it
    title = deriveTitle(input.text);
  }
  
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
      note: "",
    };
  }
  const rest = docs.filter((d) => d.id !== doc.id);
  write(store, sortNewestFirst([doc, ...rest]).slice(0, MAX_DOCUMENTS));
  return doc;
}

export function getDocument(id: string, storage?: Storage | null): SavedDocument | null {
  return read(resolve(storage)).find((d) => d.id === id) ?? null;
}

export function renameDocument(id: string, title: string, storage?: Storage | null): SavedDocument | null {
  const store = resolve(storage);
  const docs = listDocuments(store);
  const idx = docs.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  const trimmed = title.trim();
  if (!trimmed) return null;
  let newTitle = trimmed;
  if (trimmed.length > TITLE_MAX_LENGTH) {
    const slice = trimmed.slice(0, TITLE_MAX_LENGTH + 1);
    const lastSpace = slice.lastIndexOf(' ');
    const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : trimmed.slice(0, TITLE_MAX_LENGTH);
    newTitle = `${cut.replace(/\s[\s,;:\.\-–—]+$/,'')}…`;
  }
  const doc = docs[idx];
  const updated: SavedDocument = { ...doc, title: newTitle, updatedAt: Date.now() };
  const rest = docs.filter((d) => d.id !== id);
  write(store, sortNewestFirst([updated, ...rest]).slice(0, MAX_DOCUMENTS));
  return updated;
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

/**
 * Save the note for a document. The note is truncated to NOTE_MAX_LENGTH and
 * otherwise stored as-is (not trimmed). Marks the document as recently used.
 * Returns the updated document, or null if the id is unknown. Never throws.
 */
export function updateNote(
  id: string,
  note: string,
  storage?: Storage | null,
): SavedDocument | null {
  const store = resolve(storage);
  const docs = listDocuments(store);
  const doc = docs.find((d) => d.id === id);
  if (!doc) return null;
  const value = typeof note === "string" ? note.slice(0, NOTE_MAX_LENGTH) : "";
  const updated: SavedDocument = { ...doc, note: value, updatedAt: Date.now() };
  write(
    store,
    sortNewestFirst([updated, ...docs.filter((d) => d.id !== id)]),
  );
  return updated;
}

/**
 * Single-line preview of a note: whitespace collapsed, "" for blank notes,
 * long notes cut at a word boundary with an ellipsis (like deriveTitle).
 */
export function notePreview(note: string, max = NOTE_PREVIEW_LENGTH): string {
  const clean = (typeof note === "string" ? note : "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max + 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : clean.slice(0, max);
  const stripped = cut.replace(/[\s,;:.\-–—]+$/, "");
  return `${stripped || clean.slice(0, max)}…`;
}

export function deleteDocument(id: string, storage?: Storage | null): void {
  const store = resolve(storage);
  const docs = read(store);
  const rest = docs.filter((d) => d.id !== id);
  if (rest.length !== docs.length) write(store, rest);
}

/** Remove all saved documents. */
export function clearDocuments(storage?: Storage | null): void {
  const store = resolve(storage);
  write(store, []);
}

/** Remove all saved documents and return the list of deleted documents. */
export function clearDocumentsAndReturn(storage?: Storage | null): SavedDocument[] {
  const store = resolve(storage);
  const docs = read(store);
  write(store, []);
  return docs;
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