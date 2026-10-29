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
  
  // Process settings
  let settings: ReaderSettings;
  if (data.settings && typeof data.settings === "object") {
    settings = sanitizeSettings(data.settings);
  } else {
    settings = loadSettings(store);
  }
  
  // Get existing documents
  const existingDocuments = listDocuments(store);
  
  // Build merged document set correctly:
  // 1. Import all documents from backup (existing ones will be replaced)
  // 2. Add back existing documents that were not in backup
  // 3. Sort and limit properly
  
  const idToDocMap: Map<string, SavedDocument> = new Map();
  
  // Process imported docs first (they take precedence)
  for (const importedDoc of data.documents) {
    if (importedDoc && typeof importedDoc === "object" &&
        typeof importedDoc.id === "string" &&
        typeof importedDoc.title === "string" &&
        typeof importedDoc.text === "string" &&
        typeof importedDoc.source === "string" &&
        ['paste', 'file', 'pdf', 'image', 'url'].includes(importedDoc.source) &&
        typeof importedDoc.createdAt === "number" &&
        typeof importedDoc.updatedAt === "number" &&
        typeof importedDoc.lastSentenceIndex === "number" &&
        typeof importedDoc.note === "string") {
      
      idToDocMap.set(importedDoc.id, importedDoc);
    }
  }
  
  // Process existing docs - only if not in imported (they get overwritten by import)
  for (const existingDoc of existingDocuments) {
    if (!idToDocMap.has(existingDoc.id)) {
      idToDocMap.set(existingDoc.id, existingDoc); 
    }
  }
  
  // Convert back to array and sort by updatedAt
  let docsArray = Array.from(idToDocMap.values());
  docsArray.sort((a, b) => b.updatedAt - a.updatedAt);
  
  // Enforce MAX_DOCUMENTS limit
  if (docsArray.length > MAX_DOCUMENTS) {
    docsArray = docsArray.slice(0, MAX_DOCUMENTS);
  }
  
  // Final save
  try {
    saveSettings(settings, store);
    
    const storageKey = "readaloud:documents:v1";
    if (store) {
      store.setItem(storageKey, JSON.stringify(docsArray));
    }
  } catch (e) {
    throw new Error("Failed to restore backup: " + (e as Error).message);
  }
}