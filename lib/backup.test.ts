import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "@/tests/fakes/storage";
import { exportBackup, importBackup, type Backup } from "./backup";
import {
  DOCUMENTS_STORAGE_KEY,
  MAX_DOCUMENTS,
  NOTE_MAX_LENGTH,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
} from "./documents";
import { sanitizeSettings } from "./settings";

describe("exportBackup", () => {
  it("exports documents and settings", () => {
    const storage = new MemoryStorage();
    const docs = [
      {
        id: "doc1",
        title: "First",
        text: "Text 1",
        source: "paste",
        createdAt: 1000,
        updatedAt: 1000,
        lastSentenceIndex: 0,
        note: "Note 1",
      },
      {
        id: "doc2",
        title: "Second",
        text: "Text 2",
        source: "file",
        createdAt: 2000,
        updatedAt: 2000,
        lastSentenceIndex: 1,
        note: "Note 2",
      },
    ];
    const settings = { ...DEFAULT_SETTINGS, theme: "dark" as const, fontSize: 36 };

    storage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(docs));
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));

    const exported = exportBackup(storage);
    const parsed: Backup = JSON.parse(exported);

    expect(parsed.documents).toHaveLength(2);
    expect(parsed.documents[0].id).toBe("doc1");
    expect(parsed.documents[1].id).toBe("doc2");
    expect(parsed.settings.theme).toBe("dark");
    expect(parsed.settings.fontSize).toBe(36);
    expect(() => JSON.parse(exported)).not.toThrow(); // valid JSON
  });

  it("exports only documents when settings storage is missing", () => {
    const storage = new MemoryStorage();
    const docs = [
      {
        id: "doc1",
        title: "First",
        text: "Text 1",
        source: "paste",
        createdAt: 1000,
        updatedAt: 1000,
        lastSentenceIndex: 0,
        note: "Note 1",
      },
    ];

    storage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(docs));

    const exported = exportBackup(storage);
    const parsed: Backup = JSON.parse(exported);

    expect(parsed.documents).toHaveLength(1);
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("returns empty documents and defaults when nothing is stored", () => {
    const storage = new MemoryStorage();
    const exported = exportBackup(storage);
    const parsed: Backup = JSON.parse(exported);

    expect(parsed.documents).toEqual([]);
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("handles corrupt document storage gracefully", () => {
    const storage = new MemoryStorage();
    storage.setItem(DOCUMENTS_STORAGE_KEY, "{oops}");
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));

    const exported = exportBackup(storage);
    const parsed: Backup = JSON.parse(exported);

    expect(parsed.documents).toEqual([]);
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("never throws when storage fails", () => {
    const storage = new MemoryStorage();
    storage.failReads = true;

    expect(() => exportBackup(storage)).not.toThrow();
  });
});

describe("importBackup", () => {
  it("imports documents and settings from JSON", () => {
    const storage = new MemoryStorage();
    const docs = [
      {
        id: "doc1",
        title: "Imported",
        text: "Imported text",
        source: "paste",
        createdAt: 1000,
        updatedAt: 1000,
        lastSentenceIndex: 0,
        note: "Imported note",
      },
    ];
    const settings = { ...DEFAULT_SETTINGS, fontSize: 30 };

    const backupJson = JSON.stringify({ documents: docs, settings });
    const result = importBackup(backupJson, storage);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Imported");
    expect(result[0].note).toBe("Imported note");
    expect(storage.getItem(DOCUMENTS_STORAGE_KEY)).toContain("Imported text");
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toContain("30");
  });

  it("round-trips: export then import into empty storage gives the same data", () => {
    const storage = new MemoryStorage();
    const initialDocs = [
      {
        id: "doc1",
        title: "Original",
        text: "Original text",
        source: "paste",
        createdAt: 1000,
        updatedAt: 1000,
        lastSentenceIndex: 0,
        note: "Original note",
      },
    ];
    const initialSettings = { ...DEFAULT_SETTINGS, theme: "yellow-black" as const };

    storage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(initialDocs));
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(initialSettings));

    const exported = exportBackup(storage);
    const imported = importBackup(exported, storage);

    expect(imported).toHaveLength(1);
    expect(imported[0].id).toBe("doc1");
    expect(imported[0].text).toBe("Original text");
    expect(imported[0].note).toBe("Original note");
  });

  it("imports documents merged by id (imported version wins)", () => {
    const storage = new MemoryStorage();
    const existingDocs = [
      {
        id: "doc1",
        title: "Old title",
        text: "Old text",
        source: "paste",
        createdAt: 1000,
        updatedAt: 1000,
        lastSentenceIndex: 0,
        note: "Old note",
      },
    ];
    const importedDocs = [
      {
        id: "doc1",
        title: "New title",
        text: "New text",
        source: "file",
        createdAt: 2000,
        updatedAt: 2000,
        lastSentenceIndex: 1,
        note: "New note",
      },
      {
        id: "doc2",
        title: "Second",
        text: "Text 2",
        source: "url",
        createdAt: 3000,
        updatedAt: 3000,
        lastSentenceIndex: 0,
        note: "Note 2",
      },
    ];
    const settings = DEFAULT_SETTINGS;

    storage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(existingDocs));

    const backupJson = JSON.stringify({ documents: importedDocs, settings });
    const result = importBackup(backupJson, storage);

    expect(result).toHaveLength(2);
    const doc1 = result.find((d) => d.id === "doc1");
    expect(doc1).toMatchObject({
      id: "doc1",
      title: "New title",
      text: "New text",
      note: "New note",
      source: "file",
    });
    expect(storage.getItem(DOCUMENTS_STORAGE_KEY)).toContain("New text");
  });

  it("keeps at most MAX_DOCUMENTS (newest first) after import", () => {
    const storage = new MemoryStorage();
    const importedDocs = Array.from({ length: MAX_DOCUMENTS }, (_, i) => ({
      id: `doc${i}`,
      title: `Document ${i}`,
      text: `Text ${i}`,
      source: "paste",
      createdAt: 1000 + i * 100,
      updatedAt: 1000 + i * 100,
      lastSentenceIndex: 0,
      note: "",
    }));

    const backupJson = JSON.stringify({ documents: importedDocs, settings: DEFAULT_SETTINGS });
    const result = importBackup(backupJson, storage);

    expect(result).toHaveLength(MAX_DOCUMENTS);
    // Check newest first
    for (let i = 1; i < MAX_DOCUMENTS; i++) {
      expect(result[i - 1].updatedAt).toBeGreaterThan(result[i].updatedAt);
    }
  });

  it("drops documents when import exceeds MAX_DOCUMENTS, keeping newest", () => {
    const storage = new MemoryStorage();
    const importedDocs = Array.from({ length: MAX_DOCUMENTS + 5 }, (_, i) => ({
      id: `doc${i}`,
      title: `Document ${i}`,
      text: `Text ${i}`,
      source: "paste",
      createdAt: 1000 + i * 100,
      updatedAt: 1000 + i * 100,
      lastSentenceIndex: 0,
      note: "",
    }));

    const backupJson = JSON.stringify({ documents: importedDocs, settings: DEFAULT_SETTINGS });
    const result = importBackup(backupJson, storage);

    expect(result).toHaveLength(MAX_DOCUMENTS);
    // Should keep the newest 20
    const oldestRetained = result[result.length - 1].updatedAt;
    const latestDropped = importedDocs[MAX_DOCUMENTS].updatedAt;
    expect(oldestRetained).toBeGreaterThan(latestDropped);
  });

  it("sanitizes bad settings from backup", () => {
    const storage = new MemoryStorage();
    const docs = [
      {
        id: "doc1",
        title: "Test",
        text: "Test text",
        source: "paste",
        createdAt: 1000,
        updatedAt: 1000,
        lastSentenceIndex: 0,
        note: "",
      },
    ];

    // Backup with bad settings: fontSize out of range, invalid theme
    const badSettings = {
      fontSize: 500,
      lineHeight: 0,
      theme: "neon",
      fontFamily: "comic-sans" as const,
    };

    const backupJson = JSON.stringify({ documents: docs, settings: badSettings });
    const result = importBackup(backupJson, storage);

    const storedSettings = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!);
    expect(storedSettings.fontSize).toBe(96); // Clamped
    expect(storedSettings.lineHeight).toBe(1.2); // Clamped
    expect(storedSettings.theme).toBe("light"); // Default fallback
    expect(storedSettings.fontFamily).toBe("atkinson"); // Default fallback
  });

  it("throws Error for invalid JSON with clear message and leaves storage unchanged", () => {
    const storage = new MemoryStorage();
    const initialDocs = [
      {
        id: "doc1",
        title: "Original",
        text: "Original text",
        source: "paste",
        createdAt: 1000,
        updatedAt: 1000,
        lastSentenceIndex: 0,
        note: "",
      },
    ];

    storage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(initialDocs));

    const invalidJson = "{oops";
    const error = expect(() => importBackup(invalidJson, storage)).toThrowError(
      "Invalid JSON in backup"
    );

    // Storage should remain unchanged
    const storedDocs = JSON.parse(storage.getItem(DOCUMENTS_STORAGE_KEY)!);
    expect(storedDocs[0].title).toBe("Original");
  });

  it("throws Error for invalid backup format", () => {
    const storage = new MemoryStorage();
    const invalidBackups = [
      "{}",
      "[]",
      JSON.stringify({}),
      JSON.stringify({ documents: [], settings: null }),
      JSON.stringify({ documents: [], settings: 42 }),
      JSON.stringify({ documents: [] }), // missing settings
    ];

    for (const backup of invalidBackups) {
      expect(() => importBackup(backup, storage)).toThrowError(/Invalid backup format/);
      // Storage should be unchanged on parse errors
      expect(storage.getItem(DOCUMENTS_STORAGE_KEY)).toBeNull();
    }
  });

  it("ignores invalid documents and only saves valid ones", () => {
    const storage = new MemoryStorage();
    const badDocs = [
      {
        id: "doc1",
        title: "Valid",
        text: "Valid text",
        source: "paste",
        createdAt: 1000,
        updatedAt: 1000,
        lastSentenceIndex: 0,
        note: "",
      },
      {
        id: 123,
        title: "Invalid id",
        text: "Text",
        source: "paste",
        createdAt: 1001,
        updatedAt: 1001,
        lastSentenceIndex: 0,
      },
      null,
      "string",
      { id: "doc2", title: 42, text: "Text", source: "paste", createdAt: 1002, updatedAt: 1002, lastSentenceIndex: 0 },
    ];

    const backupJson = JSON.stringify({ documents: badDocs, settings: DEFAULT_SETTINGS });
    const result = importBackup(backupJson, storage);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("doc1");
  });

  it("keeps note field if present in documents", () => {
    const storage = new MemoryStorage();
    const docs = [
      {
        id: "doc1",
        title: "Test",
        text: "Test text",
        source: "paste",
        createdAt: 1000,
        updatedAt: 1000,
        lastSentenceIndex: 0,
        note: "This is a long note that should be preserved",
      },
    ];

    const backupJson = JSON.stringify({ documents: docs, settings: DEFAULT_SETTINGS });
    const result = importBackup(backupJson, storage);

    expect(result[0].note).toBe("This is a long note that should be preserved");
  });

  it("never throws when writes fail", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const docs = [
      {
        id: "doc1",
        title: "Test",
        text: "Test text",
        source: "paste",
        createdAt: 1000,
        updatedAt: 1000,
        lastSentenceIndex: 0,
        note: "",
      },
    ];

    expect(() => importBackup(JSON.stringify({ documents: docs, settings: DEFAULT_SETTINGS }), storage)).not.toThrow();
    // Should not have written anything even though it didn't throw
    expect(storage.getItem(DOCUMENTS_STORAGE_KEY)).toBeNull();
  });

  it("handles notes truncated to NOTE_MAX_LENGTH during import", () => {
    const storage = new MemoryStorage();
    const docs = [
      {
        id: "doc1",
        title: "Test",
        text: "Test text",
        source: "paste",
        createdAt: 1000,
        updatedAt: 1000,
        lastSentenceIndex: 0,
        note: "y".repeat(NOTE_MAX_LENGTH + 100),
      },
    ];

    const backupJson = JSON.stringify({ documents: docs, settings: DEFAULT_SETTINGS });
    const result = importBackup(backupJson, storage);

    expect(result[0].note).toHaveLength(NOTE_MAX_LENGTH);
    expect(() => storage.getItem(DOCUMENTS_STORAGE_KEY)).not.toThrow(); // no crash
  });

  it("leverages window.localStorage when no storage passed", () => {
    vi.stubGlobal("window", { localStorage: null });
    const storage = new MemoryStorage();
    const docs = [
      {
        id: "doc1",
        title: "Test",
        text: "Test text",
        source: "paste",
        createdAt: 1000,
        updatedAt: 1000,
        lastSentenceIndex: 0,
        note: "",
      },
    ];

    const backupJson = JSON.stringify({ documents: docs, settings: DEFAULT_SETTINGS });
    const result = importBackup(backupJson, storage);

    expect(result).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});