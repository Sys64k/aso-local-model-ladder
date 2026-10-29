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
  
  // Handle case where store might be null (no localStorage available)
  if (!store) {
    // Return empty backup object for client-side apps when localStorage is unavailable
    return JSON.stringify({
      documents: [],
      settings: {}
    });
  }
  
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
 * @throws Error if the JSON is invalid or backup restore fails.
 */
export function importBackup(json: string, storage?: Storage | null): void {
  const store = storage ?? getDefaultStorage();
  
  // Handle case where store might be null (no localStorage available)
  if (!store) {
    throw new Error("Failed to restore backup: no storage available");
  }
  
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error("Invalid backup data: failed to parse JSON");
  }
  
  // Validate the structure
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid backup data: expected object");
  }
  
  const data = parsed as Partial<BackupData>;
  
  // Check that it has required fields
  if (!Array.isArray(data.documents)) {
    throw new Error("Invalid backup data: documents must be an array");
  }
  
  // Validate settings (it's ok for it to be null/undefined)
  
  // Process documents - validate and parse individual documents
  let documents: SavedDocument[] = [];
  for (const doc of data.documents) {
    if (doc && typeof doc === "object" &&
        typeof doc.id === "string" &&
        typeof doc.title === "string" &&
        typeof doc.text === "string" &&
        typeof doc.source === "string" &&
        ['paste', 'file', 'pdf', 'image', 'url'].includes(doc.source) &&
        typeof doc.createdAt === "number" &&
        typeof doc.updatedAt === "number" &&
        typeof doc.lastSentenceIndex === "number" &&
        typeof doc.note === "string") {
      documents.push(doc as SavedDocument);
    }
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
  
  const docMap = new Map<string, SavedDocument>();
  
  // Add existing docs first (lower priority)
  for (const existingDoc of existingDocuments) {
    docMap.set(existingDoc.id, existingDoc);
  }
  
  // Then add imported docs (higher priority) - they override existing ones if same ID
  for (const importedDoc of documents) {
    docMap.set(importedDoc.id, importedDoc);
  }
  
  // Convert to array and sort newest first by updatedAt
  const allMergedDocs = Array.from(docMap.values());
  const sorted = allMergedDocs.sort((a, b) => b.updatedAt - a.updatedAt);
  
  // Limit to MAX_DOCUMENTS 
  const cappedDocuments = sorted.slice(0, MAX_DOCUMENTS);
  
  // Save everything
  try {
    saveSettings(settings, store);
    // Write documents manually to avoid conflicts with existing logic
    if (store) {
      store.setItem("readaloud:documents:v1", JSON.stringify(cappedDocuments));
    }
  } catch (e) {
    throw new Error("Failed to restore backup: " + (e as Error).message);
  }
}