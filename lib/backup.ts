import {
  MAX_DOCUMENTS,
  SavedDocument,
  listDocuments,
  read,
  write,
} from "./documents";
import { sanitizeSettings } from "./settings";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, saveSettings } from "./settings";
import { getDefaultStorage } from "./storage";

/**
 * Export current documents and settings as a JSON string for backup.
 * @param storage - Storage to read from; defaults to getDefaultStorage()
 * @returns JSON string with `documents` (array) and `settings` (object)
 */
export function exportBackup(storage?: Storage | null): string {
  const store = storage ?? getDefaultStorage();
  const docs = listDocuments(store);
  const settings = loadSettings(store);
  return JSON.stringify({ documents: docs, settings });
}

// Load settings internally
function loadSettings(store: Storage | null): unknown {
  if (!store) return DEFAULT_SETTINGS;
  try {
    const raw = store.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Import documents and settings from a JSON backup. Merges by id, keeps at most MAX_DOCUMENTS,
 * and sanitizes settings.
 * @param json - JSON string to import.
 * @param storage - Storage to write to; defaults to getDefaultStorage()
 */
export function importBackup(json: string, storage?: Storage | null): void {
  let backup: Record<string, unknown>;
  try {
    backup = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid backup JSON");
  }
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    throw new Error("Backup must be an object");
  }

  const store = storage ?? getDefaultStorage();

  // Process documents
  const importedDocs = processDocuments(backup);
  mergeDocuments(importedDocs, store);

  // Process settings
  processSettings(backup, store);
}

function processDocuments(backup: Record<string, unknown>): SavedDocument[] {
  const docs: SavedDocument[] = [];
  const rawDocs = backup.documents;
  if (!Array.isArray(rawDocs)) {
    return docs;
  }
  for (const d of rawDocs) {
    if (!isSavedDocument(d)) continue;
    docs.push(d as SavedDocument);
  }
  return docs;
}

function mergeDocuments(imported: SavedDocument[], store: Storage | null): void {
  const existing = read(store);
  const idMap = new Map<string, SavedDocument>();

  // Add existing documents
  for (const doc of existing) {
    idMap.set(doc.id, doc);
  }

  // Add imported documents (newer ones override older ones at the same id)
  for (const doc of imported) {
    idMap.set(doc.id, doc);
  }

  // Build result in newest-first order and cap at MAX_DOCUMENTS
  const result = Array.from(idMap.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_DOCUMENTS);

  write(store, result);
}

function processSettings(backup: Record<string, unknown>, store: Storage | null): void {
  const raw = backup.settings;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    saveSettings(sanitizeSettings(raw), store);
  } else {
    saveSettings(DEFAULT_SETTINGS, store);
  }
}

function isSavedDocument(d: unknown): d is SavedDocument {
  if (typeof d !== "object" || d === null) return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.text === "string" &&
    typeof o.source === "string" &&
    typeof o.createdAt === "number" &&
    typeof o.updatedAt === "number" &&
    typeof o.lastSentenceIndex === "number"
  );
}