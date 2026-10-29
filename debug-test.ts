import { MemoryStorage } from "@/tests/fakes/storage";
import { 
  exportBackup, 
  importBackup,
  BackupData 
} from "./lib/backup";
import { 
  listDocuments, 
  saveDocument,
  MAX_DOCUMENTS
} from "./lib/documents";
import { 
  loadSettings, 
  saveSettings,
  DEFAULT_SETTINGS
} from "./lib/settings";

// Create memory storage
const storage = new MemoryStorage();

// Test merge behavior
console.log("=== Testing merging case ===");

// Setup: Save one existing doc
saveDocument({ title: "Existing", text: "Content", source: "paste" }, storage);
const existingDoc = listDocuments(storage)[0];
console.log("Initial doc:", existingDoc);

// Create backup with a doc that has same ID as existing
const backupData: BackupData = {
  documents: [
    {
      id: existingDoc.id,
      title: "Updated Title",
      text: "Content", // same content
      source: "url",  
      createdAt: existingDoc.createdAt,
      updatedAt: 1_700_000_000_000, // newer timestamp 
      lastSentenceIndex: 5,
      note: "Updated note"
    }
  ],
  settings: DEFAULT_SETTINGS
};

console.log("Importing backup");
importBackup(JSON.stringify(backupData), storage);

const restoredDocs = listDocuments(storage);
console.log("Restored docs count:", restoredDocs.length);
console.log("Restored docs:", restoredDocs.map(d => ({id: d.id, title: d.title})));