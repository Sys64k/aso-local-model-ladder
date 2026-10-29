import { getDefaultStorage } from "./storage";
import {
  DOCUMENTS_STORAGE_KEY,
  MAX_DOCUMENTS,
  SavedDocument,
  listDocuments,
} from "./documents";
import {
  SETTINGS_STORAGE_KEY,
  ReaderSettings,
  loadSettings,
  sanitizeSettings,
} from "./settings";

/**
 * Export all saved documents and reader settings as a JSON string.
 * 
 * @param storage - Storage to read from (uses getDefaultStorage if not provided)
 * @returns A JSON string containing documents and settings
 */
export function exportBackup(storage?: Storage | null): string {
  const store = storage ?? getDefaultStorage();
  
  return JSON.stringify({
    documents: listDocuments(store),
    settings: loadSettings(store),
  });
}

/**
 * Import documents and settings from a backup JSON string.
 * 
 * @param json - The backup data as a JSON string
 * @param storage - Storage to write to (uses getDefaultStorage if not provided)
 * @throws Error if the JSON is invalid or doesn't contain expected structure
 */
export function importBackup(json: string, storage?: Storage | null): void {
  const store = storage ?? getDefaultStorage();
  
  // Parse the JSON first to validate it
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error("Invalid backup JSON", { cause: error });
  }
  
  // Validate that parsed data is an object with required fields
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid backup format: expected an object");
  }
  
  const parsedObj = parsed as Record<string, unknown>;
  
  // Check that the object has the required structure  
  if (!(("documents" in parsedObj) && ("settings" in parsedObj))) {
    throw new Error("Invalid backup format: missing documents or settings");
  }
  
  const obj = parsed as Record<string, unknown>;
  
  // Extract documents and settings from the parsed object
  const documentsRaw = parsedObj.documents;
  const settingsRaw = parsedObj.settings;
  
  // Validate that documents is an array (can be empty)
  let documents: SavedDocument[] = [];
  if (Array.isArray(documentsRaw)) {
    // Filter valid documents
    documents = documentsRaw
      .filter(isValidDocument)
      .map((doc) => ({
        ...doc,
        note: typeof doc.note === "string" ? doc.note : "",
      }));
  }
  
  // Load and sanitize settings 
  const settings = sanitizeSettings(settingsRaw);
  
  // First build the full list of documents by merging imported and existing
  const allDocs: SavedDocument[] = [];
  const existingDocs = listDocuments(store);
  
  // Create a map of existing documents by ID for quick lookup
  const existingDocMap = new Map<string, SavedDocument>();
  for (const doc of existingDocs) {
    existingDocMap.set(doc.id, doc);
  }
  
  // Process imported documents, replacing existing ones with same IDs
  const importedDocMap = new Map<string, SavedDocument>();
  for (const doc of documents) {
    importedDocMap.set(doc.id, doc);
  }
  
  // Add all unique document IDs
  const allIds = new Set<string>();
  for (const doc of [...existingDocs, ...documents]) {
    allIds.add(doc.id);
  }
  
  // Build the final list, with imported docs replacing existing ones with same IDs
  const mergedDocs: SavedDocument[] = [];
  for (const id of allIds) {
    if (importedDocMap.has(id)) {
      mergedDocs.push(importedDocMap.get(id)!);
    } else if (existingDocMap.has(id)) {
      mergedDocs.push(existingDocMap.get(id)!);
    }
  }
  
  // Sort by updatedAt (newest first)
  const sortedDocs = mergedDocs.sort((a, b) => b.updatedAt - a.updatedAt);
  
  // Apply MAX_DOCUMENTS cap
  const cappedDocs = sortedDocs.slice(0, MAX_DOCUMENTS);
  
  // Write everything to storage
  if (store) {
    try {
      store.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(cappedDocs));
      store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      // If writing fails, re-throw the error
      throw new Error("Failed to write backup data", { cause: error });
    }
  }
}

/**
 * Validates if an object is a valid SavedDocument.
 * 
 * @param v - The object to validate
 * @returns true if valid document, false otherwise
 */
function isValidDocument(v: unknown): v is SavedDocument {
  if (!v || typeof v !== "object") return false;
  
  const doc = v as Record<string, unknown>;
  
  // Check required fields for a valid document
  const requiredFields = [
    'id', 'title', 'text', 'source', 'createdAt', 
    'updatedAt', 'lastSentenceIndex'
  ];
  
  for (const field of requiredFields) {
    if (!(field in doc)) return false;
  }
  
  // Validate types of required fields
  if (typeof doc.id !== "string") return false;
  if (typeof doc.title !== "string") return false;
  if (typeof doc.text !== "string") return false;
  if (typeof doc.source !== "string") return false;
  const sources = ["paste", "file", "pdf", "image", "url"] as readonly string[];
  if (!sources.includes(doc.source)) return false;
  if (typeof doc.createdAt !== "number" || !Number.isFinite(doc.createdAt)) return false;
  if (typeof doc.updatedAt !== "number" || !Number.isFinite(doc.updatedAt)) return false;
  if (typeof doc.lastSentenceIndex !== "number") return false;
  
  // note field is optional and will be handled in importBackup
  
  return true;
}