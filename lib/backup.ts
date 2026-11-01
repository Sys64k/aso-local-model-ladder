import { getDefaultStorage } from "./storage";
import {
  DOCUMENTS_STORAGE_KEY,
  MAX_DOCUMENTS,
  type SavedDocument,
  listDocuments,
} from "./documents";
import {
  SETTINGS_STORAGE_KEY,
  DEFAULT_SETTINGS,
  loadSettings,
  sanitizeSettings,
} from "./settings";

/** Export all saved documents and settings as a JSON string. */
export function exportBackup(storage?: Storage | null): string {
  const store = storage ?? getDefaultStorage();
  
  // If no storage is available, return default values
  if (!store) {
    return JSON.stringify({
      documents: [],
      settings: DEFAULT_SETTINGS,
    });
  }
  
  const documents = listDocuments(store);
  const settings = loadSettings(store);
  
  return JSON.stringify({
    documents,
    settings,
  });
}

/** Import documents and settings from a backup JSON string. */
export function importBackup(json: string, storage?: Storage | null): void {
  const store = storage ?? getDefaultStorage();
  
  // If no storage is available, throw since we can't do anything
  if (!store) {
    throw new Error("No storage available for backup import");
  }
  
  // Parse the JSON first to validate it
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`Invalid backup JSON: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
  
  // Validate that the parsed data is an object with the expected structure
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid backup format: expected an object");
  }
  
  const backup = parsed as { documents?: unknown; settings?: unknown };
  
  // Handle documents
  let documents: SavedDocument[] = [];
  if (Array.isArray(backup.documents)) {
    // Filter to valid documents and sort them
    documents = backup.documents
      .filter((doc): doc is SavedDocument => {
        return (
          doc !== null &&
          typeof doc === "object" &&
          typeof doc.id === "string" &&
          typeof doc.title === "string" &&
          typeof doc.text === "string" &&
          typeof doc.source === "string" &&
          ["paste", "file", "pdf", "image", "url"].includes(doc.source) &&
          typeof doc.createdAt === "number" &&
          typeof doc.updatedAt === "number" &&
          typeof doc.lastSentenceIndex === "number" &&
          (doc.note === undefined || typeof doc.note === "string")
        );
      })
      .map((doc) => ({
        ...doc,
        note: typeof doc.note === "string" ? doc.note : "",
      }));
  }
  
  // Handle settings
  let settings = DEFAULT_SETTINGS;
  if (backup.settings && typeof backup.settings === "object" && !Array.isArray(backup.settings)) {
    settings = sanitizeSettings(backup.settings);
  }
  
  // Combine existing documents with imported ones, sort by updatedAt, and limit to MAX_DOCUMENTS
  const existingDocs = listDocuments(store);
  
  // Create a map of all documents (imported take precedence over existing)
  const allDocsMap = new Map<string, SavedDocument>();
  
  // Add imported docs (they override existing)
  for (const doc of documents) {
    allDocsMap.set(doc.id, doc);
  }
  
  // Add existing docs that aren't in the import
  for (const existingDoc of existingDocs) {
    if (!allDocsMap.has(existingDoc.id)) {
      allDocsMap.set(existingDoc.id, existingDoc);
    }
  }
  
  // Convert map back to array and sort by updatedAt descending (newest first)
  const mergedDocs = Array.from(allDocsMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  
  // Apply the cap of MAX_DOCUMENTS
  const cappedDocs = mergedDocs.slice(0, MAX_DOCUMENTS);
  
  // Write everything back
  try {
    // Update settings first
    const settingsJson = JSON.stringify(settings);
    store.setItem(SETTINGS_STORAGE_KEY, settingsJson);
    
    // Then update documents
    const docsJson = JSON.stringify(cappedDocs);
    store.setItem(DOCUMENTS_STORAGE_KEY, docsJson);
  } catch (e) {
    // If there's an error during writing, we should not change anything
    throw new Error(`Failed to import backup: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
}