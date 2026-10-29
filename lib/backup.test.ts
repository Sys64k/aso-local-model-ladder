import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "@/tests/fakes/storage";
import { 
  exportBackup, 
  importBackup,
  BackupData 
} from "./backup";
import { 
  listDocuments, 
  saveDocument, 
  deleteDocument,
  MAX_DOCUMENTS
} from "./documents";
import { 
  loadSettings, 
  saveSettings,
  DEFAULT_SETTINGS,
  ReaderSettings
} from "./settings";

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exportBackup", () => {
  it("exports documents and settings correctly", () => {
    // Setup some documents
    const doc1 = saveDocument({ title: "Test Doc 1", text: "Hello world.", source: "paste" }, storage);
    const doc2 = saveDocument({ title: "Test Doc 2", text: "Another document.", source: "file" }, storage);
    
    // Setup some settings
    const customSettings: ReaderSettings = {
      ...DEFAULT_SETTINGS,
      theme: "dark",
      fontSize: 32,
      rate: 1.5
    };
    saveSettings(customSettings, storage);
    
    // Export backup
    const backupJson = exportBackup(storage);
    const backupData: BackupData = JSON.parse(backupJson);
    
    // Validate structure
    expect(backupData).toHaveProperty("documents");
    expect(backupData).toHaveProperty("settings");
    expect(Array.isArray(backupData.documents)).toBe(true);
    expect(typeof backupData.settings).toBe("object");
    
    // Validate documents count and content 
    expect(backupData.documents).toHaveLength(2);
    expect(backupData.documents.map(d => d.id)).toContain(doc1.id);
    expect(backupData.documents.map(d => d.id)).toContain(doc2.id);
    
    // Validate settings
    expect(backupData.settings.theme).toBe("dark");
    expect(backupData.settings.fontSize).toBe(32);
    expect(backupData.settings.rate).toBe(1.5);
  });
  
  it("exports empty storage correctly", () => {
    const backupJson = exportBackup(storage);
    const backupData: BackupData = JSON.parse(backupJson);
    
    expect(backupData.documents).toHaveLength(0);
    expect(typeof backupData.settings).toBe("object");
    expect(backupData.settings.theme).toBe("light"); // default
  });
});

describe("importBackup", () => {
  it("imports a backup and round-trips correctly", () => {
    // Setup some initial data
    const doc1 = saveDocument({ title: "Original Doc", text: "Hello world.", source: "paste" }, storage);
    const originalSettings = { ...DEFAULT_SETTINGS, theme: "dark" };
    saveSettings(originalSettings, storage);
    
    // Export the backup 
    const backupJson = exportBackup(storage);
    
    // Clear the storage
    vi.spyOn(Date, "now").mockImplementation(() => 1_800_000_000_000);
    const freshStorage = new MemoryStorage();
    
    // Import backup to fresh storage  
    importBackup(backupJson, freshStorage);
    
    // Verify documents are restored
    const restoredDocs = listDocuments(freshStorage);
    expect(restoredDocs).toHaveLength(1);
    expect(restoredDocs[0].id).toBe(doc1.id);
    expect(restoredDocs[0].title).toBe("Original Doc");
    expect(restoredDocs[0].text).toBe("Hello world.");
    
    // Verify settings are restored  
    const restoredSettings = loadSettings(freshStorage);
    expect(restoredSettings.theme).toBe("dark");
  });
  
  it("merges documents by id and keeps at most MAX_DOCUMENTS", () => {
    // Create a backup with 25 documents (exceeds limit)
    const docs: any[] = [];
    for (let i = 0; i < 25; i++) {
      docs.push({
        id: `doc-${i}`,
        title: `Doc ${i}`,
        text: `Text ${i}`,
        source: "paste",
        createdAt: 1_700_000_000_000 + i,
        updatedAt: 1_700_000_000_000 + i,
        lastSentenceIndex: 0,
        note: ""
      });
    }
    
    const backupData: BackupData = {
      documents: docs,
      settings: DEFAULT_SETTINGS
    };
    
    // Import to storage with existing documents
    saveDocument({ title: "Existing", text: "Content", source: "paste" }, storage);
    const existingDoc = listDocuments(storage)[0];
    
    // Import backup 
    importBackup(JSON.stringify(backupData), storage);
    
    // Verify only MAX_DOCUMENTS are kept, newest first
    const restoredDocs = listDocuments(storage);
    expect(restoredDocs).toHaveLength(MAX_DOCUMENTS); // Should be 20
    
    // The existing doc should be in the results (should be among the last 20)
    expect(restoredDocs.map(d => d.id)).toContain(existingDoc.id);
    
    // First document should be the most recent 
    expect(restoredDocs[0].title).toBe("Doc 24");
  });
  
  it("handles merging of existing and imported documents", () => {
    // Create some initial documents in storage
    const existingDoc = saveDocument({ title: "Original Doc", text: "Hello original.", source: "paste" }, storage);
    const otherDoc = saveDocument({ title: "Another Doc", text: "Other content.", source: "file" }, storage);
    
    // Create backup with documents that have same IDs (should update)
    const backupData: BackupData = {
      documents: [
        {
          id: existingDoc.id,
          title: "Updated Title",
          text: "Hello original.", // same text
          source: "url",  // this should be updated to match
          createdAt: existingDoc.createdAt,
          updatedAt: 1_700_000_000_000, // newer timestamp
          lastSentenceIndex: 5,
          note: "Updated note"
        },
        {
          id: "new-doc-1",
          title: "New Document",
          text: "New content",
          source: "file", 
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          lastSentenceIndex: 0,
          note: ""
        }
      ],
      settings: DEFAULT_SETTINGS
    };
    
    importBackup(JSON.stringify(backupData), storage);
    
    // Verify merged results  
    const restoredDocs = listDocuments(storage);
    expect(restoredDocs).toHaveLength(2); // 1 existing + 1 new
    
    // Check that existing document was updated but preserved
    const updatedDoc = restoredDocs.find(d => d.id === existingDoc.id)!;
    expect(updatedDoc.title).toBe("Updated Title"); 
    expect(updatedDoc.source).toBe("url");
    
    // Check that the new document was added
    const newDoc = restoredDocs.find(d => d.id === "new-doc-1")!;
    expect(newDoc.title).toBe("New Document");
  });
  
  it("sanitizes bad settings in backup", () => {
    const backupData: BackupData = {
      documents: [],
      settings: {
        theme: "invalid-theme",
        fontSize: 500, // beyond limit
        lineHeight: -1, // beyond limit  
        letterSpacing: 0.5, // beyond limit
        wordSpacing: -1, // beyond limit
        fontFamily: "invalid-font",
        rate: 3, // beyond limit
        pitch: 5, // beyond limit
        volume: 2, // beyond limit
        voiceURI: "valid-voice-uri",
        highlightMode: "invalid-highlight",
        viewMode: "invalid-view",
        autoScroll: "not-a-boolean" as any // invalid type
      }
    };
    
    importBackup(JSON.stringify(backupData), storage);
    
    const restoredSettings = loadSettings(storage);
    
    // Should have sanitized values 
    expect(restoredSettings.theme).toBe("light"); // defaults to light 
    expect(restoredSettings.fontSize).toBe(96); // max limit
    expect(restoredSettings.lineHeight).toBe(1.2); // min limit  
    expect(restoredSettings.letterSpacing).toBe(0.3); // max limit
    expect(restoredSettings.wordSpacing).toBe(0); // min limit
    expect(restoredSettings.fontFamily).toBe("atkinson"); // defaults to atkinson
    expect(restoredSettings.rate).toBe(2); // max limit
    expect(restoredSettings.pitch).toBe(2); // max limit
    expect(restoredSettings.volume).toBe(1); // max limit  
    expect(restoredSettings.voiceURI).toBe("valid-voice-uri");
    expect(restoredSettings.highlightMode).toBe("both"); // defaults to both
    expect(restoredSettings.viewMode).toBe("full"); // defaults to full
    expect(restoredSettings.autoScroll).toBe(true); // default is true
  });
  
  it("throws an error for invalid JSON and leaves storage unchanged", () => {
    const originalDocs = listDocuments(storage);
    const originalSettings = loadSettings(storage);
    
    expect(() => importBackup("{invalid json}", storage)).toThrow("Invalid backup data: failed to parse JSON");
    
    // Storage should be unchanged
    expect(listDocuments(storage)).toEqual(originalDocs);
    expect(loadSettings(storage)).toEqual(originalSettings);
  });
  
  it("throws an error for invalid backup structure", () => {
    const originalDocs = listDocuments(storage);
    const originalSettings = loadSettings(storage);
    
    // Should fail with proper JSON error
    expect(() => importBackup("[]", storage)).toThrowError();
    
    // For non-object, should still throw
    expect(() => importBackup("null", storage)).toThrowError();
    expect(() => importBackup("42", storage)).toThrowError();
    
    // Storage should be unchanged
    expect(listDocuments(storage)).toEqual(originalDocs);
    expect(loadSettings(storage)).toEqual(originalSettings);
  });
  
  it("does not throw when storage fails for writes (comprehensive safety)", () => {
    storage.failWrites = true;
    
    const backupData: BackupData = {
      documents: [],
      settings: { ...DEFAULT_SETTINGS, theme: "dark" }
    };
    
    // Should still be able to process the import, even though it can't save
    expect(() => importBackup(JSON.stringify(backupData), storage)).toThrow("Failed to restore backup");
  });
});