import type { SavedDocument } from "./documents";
import type { ReaderSettings } from "./settings";
import {
  MAX_DOCUMENTS,
  NOTE_MAX_LENGTH,
  DOCUMENTS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from "./documents";
import { loadSettings, saveSettings, sanitizeSettings } from "./settings";

/**
 * JSON structure exported by exportBackup.
 * { documents: SavedDocument[], settings: ReaderSettings }.
 */
export interface Backup {
  documents: SavedDocument[];
  settings: ReaderSettings;
}

/**
 * Export all saved documents and current reader settings as a JSON string.
 *
 * @param storage - Optional storage instance; defaults to localStorage.
 * @returns JSON string containing documents and settings.
 * @throws If JSON.stringify fails (should not happen for normal objects).
 */
export function exportBackup(storage?: Storage | null): string {
  const documents = getDocuments(storage);
  const settings = loadSettings(storage);
  return JSON.stringify({ documents, settings });
}

/**
 * Restore documents and settings from a backup JSON string.
 *
 * Documents are merged by id (imported version wins), capped at MAX_DOCUMENTS (newest first).
 * Settings are sanitized and replace all existing settings.
 *
 * @param json - JSON string containing a Backup object.
 * @param storage - Optional storage instance; defaults to localStorage.
 * @throws If json is not valid JSON or does not contain expected structure.
 * @returns The restored documents array.
 */
export function importBackup(json: string, storage?: Storage | null): SavedDocument[] {
  try {
    const backup: unknown = JSON.parse(json);
    if (
      typeof backup !== "object" ||
      backup === null ||
      !("documents" in backup) ||
      !("settings" in backup) ||
      !Array.isArray(backup.documents) ||
      typeof backup.settings !== "object" ||
      backup.settings === null
    ) {
      throw new Error("Invalid backup format: must contain 'documents' and 'settings'.");
    }

    // Merge documents: imported version wins, keep at most MAX_DOCUMENTS (newest first)
    const importedDocs = backup.documents.filter(isValidDocument);
    const existingDocs = getDocuments(storage);
    const importedMap = new Map<string, SavedDocument>();

    // Load imported docs into a map (later imports override earlier ones for same id)
    for (const doc of importedDocs) {
      if (isValidDocument(doc)) {
        importedMap.set(doc.id, { ...doc });
      }
    }

    // Merge: existing docs that aren't in the import become part of the result
    for (const doc of existingDocs) {
      if (!importedMap.has(doc.id)) {
        importedMap.set(doc.id, { ...doc });
      }
    }

    // Keep at most MAX_DOCUMENTS, newest first
    const finalDocs = Array.from(importedMap.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_DOCUMENTS);

    // Save documents
    saveDocuments(storage, finalDocs);

    // Sanitize and save settings
    const sanitizedSettings = sanitizeSettings(backup.settings);
    saveSettings(sanitizedSettings, storage);

    return finalDocs;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error("Invalid JSON in backup: " + err.message);
    }
    throw err;
  }
}

// --- Helper functions (not exported) ---

function getDocuments(storage?: Storage | null): SavedDocument[] {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return [];
  try {
    const raw = store.getItem(DOCUMENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidDocument);
  } catch {
    return [];
  }
}

function saveDocuments(storage?: Storage | null, docs: SavedDocument[] = []): void {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return;
  try {
    store.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(docs));
  } catch {
    // Ignore quota exceeded
  }
}

function isValidDocument(v: unknown): v is SavedDocument {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.title === "string" &&
    typeof d.text === "string" &&
    typeof d.source === "string" &&
    typeof d.createdAt === "number" &&
    typeof d.updatedAt === "number" &&
    typeof d.lastSentenceIndex === "number"
  );
}