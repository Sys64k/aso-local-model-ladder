import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "@/tests/fakes/storage";
import { exportBackup, importBackup } from "./backup";
import {
  DOCUMENTS_STORAGE_KEY,
  MAX_DOCUMENTS,
  type SavedDocument,
  listDocuments,
  saveDocument,
} from "./documents";
import {
  DEFAULT_SETTINGS,
  type ReaderSettings,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  sanitizeSettings,
  saveSettings,
} from "./settings";

/**
 * Backup format assumed by these tests: a JSON object with (at least)
 *   { documents: SavedDocument[], settings: ReaderSettings }
 * Extra top-level fields (e.g. a version or exportedAt) are allowed.
 */

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

afterEach(() => {
  window.localStorage.clear();
});

function makeDoc(id: string, updatedAt: number, overrides: Partial<SavedDocument> = {}): SavedDocument {
  return {
    id,
    title: `Title ${id}`,
    text: `Text of ${id}.`,
    source: "paste",
    createdAt: updatedAt - 10,
    updatedAt,
    lastSentenceIndex: 0,
    note: "",
    ...overrides,
  };
}

function seedDocs(store: MemoryStorage, docs: SavedDocument[]): void {
  store.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(docs));
}

function backupJson(documents: unknown[], settings: unknown = DEFAULT_SETTINGS): string {
  return JSON.stringify({ documents, settings });
}

function snapshot(store: MemoryStorage) {
  return {
    docs: store.getItem(DOCUMENTS_STORAGE_KEY),
    settings: store.getItem(SETTINGS_STORAGE_KEY),
    writes: store.writes,
    length: store.length,
  };
}

const CUSTOM_SETTINGS: ReaderSettings = {
  ...DEFAULT_SETTINGS,
  theme: "sepia",
  fontSize: 40,
  rate: 1.5,
  voiceURI: "voice-1",
  highlightMode: "word",
  viewMode: "focus",
  autoScroll: false,
};

describe("exportBackup", () => {
  it("returns a JSON string with every saved document and the reader settings", () => {
    const docs = [
      makeDoc("a", 3000, { note: "note a", lastSentenceIndex: 4 }),
      makeDoc("b", 2000, { source: "pdf" }),
      makeDoc("c", 1000, { source: "url", note: "line 1\nline 2" }),
    ];
    seedDocs(storage, docs);
    saveSettings(CUSTOM_SETTINGS, storage);

    const json = exportBackup(storage);
    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json);
    expect(parsed.documents).toEqual(listDocuments(storage));
    expect(parsed.documents).toHaveLength(3);
    expect(parsed.settings).toEqual(CUSTOM_SETTINGS);
  });

  it("exports an empty document list and default settings from empty storage", () => {
    const parsed = JSON.parse(exportBackup(storage));
    expect(parsed.documents).toEqual([]);
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("does not write to storage", () => {
    seedDocs(storage, [makeDoc("a", 1000)]);
    const before = snapshot(storage);
    exportBackup(storage);
    expect(snapshot(storage)).toEqual(before);
  });

  it("uses localStorage when no storage is given", () => {
    const doc = saveDocument({ title: "Local", text: "Stored locally.", source: "paste" });
    saveSettings({ ...DEFAULT_SETTINGS, theme: "dark" });
    const parsed = JSON.parse(exportBackup());
    expect(parsed.documents).toEqual([doc]);
    expect(parsed.settings.theme).toBe("dark");
  });
});

describe("importBackup", () => {
  it("round-trips: export then import into empty storage gives the same documents and settings", () => {
    seedDocs(storage, [
      makeDoc("a", 3000, { note: "keep me", lastSentenceIndex: 7, source: "image" }),
      makeDoc("b", 2000, { title: "Second", source: "file" }),
      makeDoc("c", 1000),
    ]);
    saveSettings(CUSTOM_SETTINGS, storage);

    const target = new MemoryStorage();
    importBackup(exportBackup(storage), target);

    expect(listDocuments(target)).toEqual(listDocuments(storage));
    expect(loadSettings(target)).toEqual(CUSTOM_SETTINGS);
    const again = JSON.parse(exportBackup(target));
    expect(again.documents).toEqual(JSON.parse(exportBackup(storage)).documents);
    expect(again.settings).toEqual(CUSTOM_SETTINGS);
  });

  it("round-trips an empty backup", () => {
    const target = new MemoryStorage();
    importBackup(exportBackup(storage), target);
    expect(listDocuments(target)).toEqual([]);
    expect(loadSettings(target)).toEqual(DEFAULT_SETTINGS);
  });

  it("merges by id: the imported document wins, others are kept", () => {
    seedDocs(storage, [
      makeDoc("x", 5000, { title: "Local x", note: "local note" }),
      makeDoc("y", 4000),
    ]);
    const importedX = makeDoc("x", 6000, { title: "Imported x", note: "imported note", lastSentenceIndex: 2 });
    const importedZ = makeDoc("z", 1000);
    importBackup(backupJson([importedX, importedZ]), storage);

    const list = listDocuments(storage);
    expect(list.map((d) => d.id)).toEqual(["x", "y", "z"]);
    expect(list.find((d) => d.id === "x")).toEqual(importedX);
    expect(list.filter((d) => d.id === "x")).toHaveLength(1);
  });

  it("the imported document wins even when it is older than the local one", () => {
    seedDocs(storage, [makeDoc("x", 9000, { title: "Newer local" }), makeDoc("y", 5000)]);
    const importedX = makeDoc("x", 1000, { title: "Older imported" });
    importBackup(backupJson([importedX]), storage);

    const list = listDocuments(storage);
    expect(list).toHaveLength(2);
    expect(list.find((d) => d.id === "x")).toEqual(importedX);
    expect(list.map((d) => d.id)).toEqual(["y", "x"]);
  });

  it("keeps at most MAX_DOCUMENTS, newest first, dropping the oldest", () => {
    // 15 local (updatedAt 1000..15000, odd thousands interleaved with imports)
    const local = Array.from({ length: 15 }, (_, i) => makeDoc(`local-${i}`, (i + 1) * 1000));
    const imported = Array.from({ length: 10 }, (_, i) => makeDoc(`imp-${i}`, (i + 1) * 1000 + 500));
    seedDocs(storage, local);
    importBackup(backupJson(imported), storage);

    const all = [...local, ...imported].sort((a, b) => b.updatedAt - a.updatedAt);
    const expected = all.slice(0, MAX_DOCUMENTS);
    const list = listDocuments(storage);
    expect(list).toHaveLength(MAX_DOCUMENTS);
    expect(list.map((d) => d.id)).toEqual(expected.map((d) => d.id));
    // The raw stored list is capped too, not just the listing.
    expect(JSON.parse(storage.getItem(DOCUMENTS_STORAGE_KEY)!)).toHaveLength(MAX_DOCUMENTS);
    // The five oldest are gone.
    for (const dropped of all.slice(MAX_DOCUMENTS)) {
      expect(list.some((d) => d.id === dropped.id)).toBe(false);
    }
  });

  it("caps a backup that alone holds more than MAX_DOCUMENTS", () => {
    const imported = Array.from({ length: MAX_DOCUMENTS + 5 }, (_, i) => makeDoc(`imp-${i}`, (i + 1) * 1000));
    importBackup(backupJson(imported), storage);
    const list = listDocuments(storage);
    expect(list).toHaveLength(MAX_DOCUMENTS);
    expect(list[0].id).toBe(`imp-${MAX_DOCUMENTS + 4}`);
    expect(list[MAX_DOCUMENTS - 1].id).toBe("imp-5");
  });

  it("keeps exactly MAX_DOCUMENTS when the merge reaches the limit", () => {
    const half = MAX_DOCUMENTS / 2;
    const local = Array.from({ length: half }, (_, i) => makeDoc(`local-${i}`, (i + 1) * 1000));
    const imported = Array.from({ length: half }, (_, i) => makeDoc(`imp-${i}`, (i + 1) * 1000 + 500));
    seedDocs(storage, local);
    importBackup(backupJson(imported), storage);
    expect(listDocuments(storage)).toHaveLength(MAX_DOCUMENTS);
  });

  it("counts a document present on both sides only once toward the limit", () => {
    // 15 local + 10 imported, 5 of which share ids with local docs → 20 unique.
    const local = Array.from({ length: 15 }, (_, i) => makeDoc(`d-${i}`, (i + 1) * 1000));
    const imported = Array.from({ length: 10 }, (_, i) =>
      makeDoc(`d-${i + 10}`, (i + 1) * 1000 + 100000, { title: `Imported ${i + 10}` }),
    );
    seedDocs(storage, local);
    importBackup(backupJson(imported), storage);

    const list = listDocuments(storage);
    expect(list).toHaveLength(MAX_DOCUMENTS);
    expect(new Set(list.map((d) => d.id)).size).toBe(MAX_DOCUMENTS);
    for (let i = 0; i < 20; i++) {
      expect(list.some((d) => d.id === `d-${i}`)).toBe(true);
    }
    expect(list.find((d) => d.id === "d-12")?.title).toBe("Imported 12");
  });

  it("restores the settings from the backup", () => {
    saveSettings({ ...DEFAULT_SETTINGS, theme: "dark" }, storage);
    importBackup(backupJson([], CUSTOM_SETTINGS), storage);
    expect(loadSettings(storage)).toEqual(CUSTOM_SETTINGS);
  });

  it("sanitizes bad settings in a backup", () => {
    const bad = {
      theme: "neon",
      fontSize: 1000,
      rate: 0.1,
      volume: "loud",
      fontFamily: "comic-sans",
      highlightMode: "word",
      voiceURI: 12,
      autoScroll: "yes",
    };
    importBackup(backupJson([], bad), storage);
    const expected = { ...DEFAULT_SETTINGS, fontSize: 96, rate: 0.5, highlightMode: "word" };
    expect(sanitizeSettings(bad)).toEqual(expected);
    expect(loadSettings(storage)).toEqual(expected);
    // The stored value itself is clean, not just the loaded one.
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual(expected);
  });

  it("passes partial settings through sanitizeSettings (missing fields become defaults)", () => {
    saveSettings(CUSTOM_SETTINGS, storage);
    importBackup(backupJson([], { theme: "high-contrast" }), storage);
    expect(loadSettings(storage)).toEqual(sanitizeSettings({ theme: "high-contrast" }));
  });

  it("skips invalid documents in a backup and fills a missing note with an empty string", () => {
    const valid = makeDoc("ok", 2000);
    const { note: _note, ...noNote } = makeDoc("old", 1000);
    void _note;
    importBackup(
      backupJson([valid, noNote, null, "x", { id: 1 }, { ...makeDoc("bad", 3000), source: "bogus" }]),
      storage,
    );
    const list = listDocuments(storage);
    expect(list.map((d) => d.id)).toEqual(["ok", "old"]);
    expect(list[1].note).toBe("");
  });

  it("uses localStorage when no storage is given", () => {
    importBackup(backupJson([makeDoc("a", 1000)], { ...DEFAULT_SETTINGS, theme: "sepia" }));
    expect(listDocuments().map((d) => d.id)).toEqual(["a"]);
    expect(loadSettings().theme).toBe("sepia");
  });

  it("throws a clear Error on invalid JSON and leaves storage unchanged", () => {
    seedDocs(storage, [makeDoc("a", 2000, { note: "n" }), makeDoc("b", 1000)]);
    saveSettings(CUSTOM_SETTINGS, storage);
    const before = snapshot(storage);

    for (const input of ["{not json", "", "   ", '{"documents": [', "undefined"]) {
      let error: unknown;
      try {
        importBackup(input, storage);
      } catch (e) {
        error = e;
      }
      expect(error, `input ${JSON.stringify(input)} should throw`).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/json|backup|invalid/i);
      expect(snapshot(storage)).toEqual(before);
    }
    expect(listDocuments(storage).map((d) => d.id)).toEqual(["a", "b"]);
    expect(loadSettings(storage)).toEqual(CUSTOM_SETTINGS);
  });

  it("throws and leaves storage unchanged when the JSON is not a backup object", () => {
    seedDocs(storage, [makeDoc("a", 1000)]);
    saveSettings(CUSTOM_SETTINGS, storage);
    const before = snapshot(storage);

    for (const input of ["null", "42", '"text"', "[]", "true"]) {
      expect(() => importBackup(input, storage), `input ${input}`).toThrow(Error);
      expect(snapshot(storage)).toEqual(before);
    }
  });
});
