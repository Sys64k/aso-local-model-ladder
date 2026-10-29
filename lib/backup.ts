import { listDocuments, SavedDocument, MAX_DOCUMENTS } from "./documents";
import { loadSettings, ReaderSettings, saveSettings, sanitizeSettings } from "./settings";
import { getDefaultStorage } from "./storage";

export interface BackupData {
  documents: SavedDocument[];
  settings: ReaderSettings;
}

/**
 * Exports all saved documents and reader settings as a JSON string.
 * @param storage Optional storage to read from; uses default if not provided.
 * @returns A JSON string representing the backup data.
 */
export function exportBackup(storage?: Storage | null): string {
  const store = storage ?? getDefaultStorage();
  
  const documents = listDocuments(store);
  const settings = loadSettings(store);
  
  const backupData: BackupData = {
    documents,
    settings,
  };
  
  return JSON.stringify(backupData);
}

/**
 * Imports documents and settings from a backup JSON string.
 * @param json The JSON string containing the backup data.
 * @param storage Optional storage to write to; uses default if not provided.
 * @throws Error if the JSON is invalid.
 */
export function importBackup(json: string, storage?: Storage | null): void {
  const store = storage ?? getDefaultStorage();
  
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error("Invalid backup data: failed to parse JSON");
  }
  
  // Validate the structure
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid backup data: expected object");
  }
  
  const data = parsed as Partial<BackupData>;
  
  // Process documents
  let documents: SavedDocument[] = [];
  if (Array.isArray(data.documents)) {
    documents = data.documents.filter((doc): doc is SavedDocument => {
      return (
        typeof doc === "object" &&
        doc !== null &&
        typeof doc.id === "string" &&
        typeof doc.title === "string" &&
        typeof doc.text === "string" &&
        typeof doc.source === "string" &&
        ['paste', 'file', 'pdf', 'image', 'url'].includes(doc.source) &&
        typeof doc.createdAt === "number" &&
        typeof doc.updatedAt === "number" &&
        typeof doc.lastSentenceIndex === "number" &&
        typeof doc.note === "string"
      );
    });
  }
  
  // Process settings
  let settings: ReaderSettings;
  if (data.settings && typeof data.settings === "object") {
    // Use sanitizeSettings to properly clean up settings 
    settings = sanitizeSettings(data.settings);
  } else {
    // Load the current settings if nothing was provided in backup
    settings = loadSettings(store);
  }
  
  // Merge all documents - imported ones overwrite existing ones with same ID
  const existingDocuments = listDocuments(store);
  const docIdSet = new Set<string>();
  const allDocs: SavedDocument[] = [];
  
  // Add imported documents first (they take precedence)
  for (const doc of documents) {
    allDocs.push(doc);
    docIdSet.add(doc.id);
  }
  
  // Add existing documents that weren't in backup
  for (const existingDoc of existingDocuments) {
    if (!docIdSet.has(existingDoc.id)) {
      allDocs.push(existingDoc);
    }
  }
  
  // Sort by update time (newest first) 
  const sorted = allDocs.sort((a, b) => b.updatedAt - a.updatedAt);
  
  // Apply MAX_DOCUMENTS limit 
  const cappedDocuments = sorted.slice(0, MAX_DOCUMENTS);
  
  // Save everything
  saveSettings(settings, store);
  
  // Write documents manually to avoid conflicts with existing save logic
  if (store) {
    store.setItem("readaloud:documents:v1", JSON.stringify(cappedDocuments));
  }
}