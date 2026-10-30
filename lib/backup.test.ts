import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "@/tests/fakes/storage";
import { exportBackup, importBackup } from "./backup";
import {
  DOCUMENTS_STORAGE_KEY,
  MAX_DOCUMENTS,
  type SavedDocument,
  listDocuments,
  saveDocument,
  updateNote,
  updateProgress,
} from "./documents";
import {
  DEFAULT_SETTINGS,
  type ReaderSettings,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  saveSettings,
} from "./settings";

let now: number;

beforeEach(() => {
  now = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function tick(ms = 1000) {
  now += ms;
}

function doc(id: string, updatedAt: number, overrides: Partial<SavedDocument> = {}): SavedDocument {
  return {
    id,
    title: `Title ${id}`,
    text: `Text of ${id}.`,
    source: "paste",
    createdAt: updatedAt,
    updatedAt,
    lastSentenceIndex: 0,
    note: "",
    ...overrides,
  };
}

function seedDocuments(storage: MemoryStorage, docs: unknown[]): void {
  storage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(docs));
}

/**
 * Builds a backup JSON string in whatever shape exportBackup produces, with
 * the top-level `documents` / `settings` fields replaced.
 */
function backupWith(fields: { documents?: unknown; settings?: unknown }): string {
  const base = JSON.parse(exportBackup(new MemoryStorage())) as Record<string, unknown>;
  return JSON.stringify({ ...base, ...fields });
}

const customSettings: ReaderSettings = {
  ...DEFAULT_SETTINGS,
  theme: "sepia",
  fontSize: 40,
  lineHeight: 2.2,
  fontFamily: "lexend",
  rate: 1.5,
  voiceURI: "voice-1",
  highlightMode: "word",
  viewMode: "focus",
  autoScroll: false,
};

describe("exportBackup", () => {
  it("returns a JSON string holding every saved document and the settings", () => {
    const storage = new MemoryStorage();
    const a = saveDocument({ title: "A", text: "Alpha text.", source: "paste" }, storage);
    tick();
    const b = saveDocument({ title: "B", text: "Beta text.", source: "pdf" }, storage);
    updateNote(a.id, "a note", storage);
    saveSettings(customSettings, storage);

    const json = exportBackup(storage);
    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json) as { documents: SavedDocument[]; settings: ReaderSettings };
    expect(parsed.documents).toHaveLength(2);
    expect(parsed.documents).toEqual(expect.arrayContaining(listDocuments(storage)));
    expect(parsed.documents.map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
    expect(parsed.settings).toEqual(customSettings);
  });

  it("exports empty documents and default settings from empty storage", () => {
    const parsed = JSON.parse(exportBackup(new MemoryStorage())) as {
      documents: unknown;
      settings: unknown;
    };
    expect(parsed.documents).toEqual([]);
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("does not write to storage", () => {
    const storage = new MemoryStorage();
    saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    const writes = storage.writes;
    exportBackup(storage);
    expect(storage.writes).toBe(writes);
  });
});

describe("importBackup round trip", () => {
  it("export then import into empty storage gives the same documents and settings", () => {
    const source = new MemoryStorage();
    const a = saveDocument({ title: "A", text: "Alpha. Two.", source: "file" }, source);
    tick();
    const b = saveDocument({ title: "B", text: "Beta.", source: "url" }, source);
    tick();
    saveDocument({ title: "C", text: "Gamma.", source: "image" }, source);
    updateProgress(a.id, 1, source);
    tick();
    updateNote(b.id, "  my\nnote  ", source);
    saveSettings(customSettings, source);

    const target = new MemoryStorage();
    importBackup(exportBackup(source), target);

    expect(listDocuments(target)).toEqual(listDocuments(source));
    expect(loadSettings(target)).toEqual(customSettings);
  });

  it("round-trips an empty backup", () => {
    const target = new MemoryStorage();
    importBackup(exportBackup(new MemoryStorage()), target);
    expect(listDocuments(target)).toEqual([]);
    expect(loadSettings(target)).toEqual(DEFAULT_SETTINGS);
  });

  it("uses localStorage when no storage is given", () => {
    localStorage.clear();
    try {
      const source = new MemoryStorage();
      saveDocument({ title: "A", text: "Alpha.", source: "paste" }, source);
      saveSettings(customSettings, source);
      importBackup(exportBackup(source));
      expect(listDocuments(localStorage)).toEqual(listDocuments(source));
      expect(loadSettings(localStorage)).toEqual(customSettings);
      const exported = JSON.parse(exportBackup()) as { documents: unknown; settings: unknown };
      expect(exported.documents).toEqual(listDocuments(source));
      expect(exported.settings).toEqual(customSettings);
    } finally {
      localStorage.clear();
    }
  });
});

describe("importBackup merging", () => {
  it("merges by id: imported documents win, others are kept, newest first", () => {
    const storage = new MemoryStorage();
    seedDocuments(storage, [
      doc("a", 300, { title: "Local A", note: "local note" }),
      doc("b", 200, { title: "Local B" }),
    ]);
    importBackup(
      backupWith({
        documents: [
          doc("a", 100, { title: "Imported A", note: "imported note", lastSentenceIndex: 5 }),
          doc("c", 400, { title: "Imported C" }),
        ],
      }),
      storage,
    );
    const list = listDocuments(storage);
    expect(list.map((d) => d.id)).toEqual(["c", "b", "a"]);
    // The imported copy replaces the local one completely, even though it is older.
    expect(list.find((d) => d.id === "a")).toEqual(
      doc("a", 100, { title: "Imported A", note: "imported note", lastSentenceIndex: 5 }),
    );
    expect(list.find((d) => d.id === "b")?.title).toBe("Local B");
    expect(list.filter((d) => d.id === "a")).toHaveLength(1);
  });

  it("stores documents sorted newest first", () => {
    const storage = new MemoryStorage();
    importBackup(
      backupWith({ documents: [doc("old", 1), doc("new", 3), doc("mid", 2)] }),
      storage,
    );
    const raw = JSON.parse(storage.getItem(DOCUMENTS_STORAGE_KEY)!) as SavedDocument[];
    expect(raw.map((d) => d.id)).toEqual(["new", "mid", "old"]);
  });

  it("keeps at most MAX_DOCUMENTS, dropping the oldest across both sets", () => {
    const storage = new MemoryStorage();
    const local = Array.from({ length: 15 }, (_, i) => doc(`local-${i}`, i * 2));
    const imported = Array.from({ length: 15 }, (_, i) => doc(`imported-${i}`, i * 2 + 1));
    seedDocuments(storage, local);
    importBackup(backupWith({ documents: imported }), storage);

    const list = listDocuments(storage);
    expect(list).toHaveLength(MAX_DOCUMENTS);
    const expected = [...local, ...imported]
      .sort((x, y) => y.updatedAt - x.updatedAt)
      .slice(0, MAX_DOCUMENTS)
      .map((d) => d.id);
    expect(list.map((d) => d.id)).toEqual(expected);
    const raw = JSON.parse(storage.getItem(DOCUMENTS_STORAGE_KEY)!) as unknown[];
    expect(raw).toHaveLength(MAX_DOCUMENTS);
  });

  it("caps a backup that alone holds more than MAX_DOCUMENTS", () => {
    const storage = new MemoryStorage();
    const imported = Array.from({ length: MAX_DOCUMENTS + 5 }, (_, i) => doc(`d${i}`, i));
    importBackup(backupWith({ documents: imported }), storage);
    const list = listDocuments(storage);
    expect(list).toHaveLength(MAX_DOCUMENTS);
    expect(list[0].id).toBe(`d${MAX_DOCUMENTS + 4}`);
    expect(list[MAX_DOCUMENTS - 1].id).toBe("d5");
    expect(list.some((d) => d.id === "d4")).toBe(false);
  });

  it("counts a document present in both sets once (exactly MAX_DOCUMENTS kept)", () => {
    const storage = new MemoryStorage();
    // 15 local + 10 imported, 5 of which share ids with local ones = 20 unique.
    const local = Array.from({ length: 15 }, (_, i) => doc(`d${i}`, i));
    const imported = Array.from({ length: 10 }, (_, i) =>
      doc(`d${i + 10}`, 100 + i, { title: `Imported ${i + 10}` }),
    );
    seedDocuments(storage, local);
    importBackup(backupWith({ documents: imported }), storage);
    const list = listDocuments(storage);
    expect(list).toHaveLength(MAX_DOCUMENTS);
    expect(new Set(list.map((d) => d.id)).size).toBe(MAX_DOCUMENTS);
    for (let i = 0; i < MAX_DOCUMENTS; i++) {
      expect(list.some((d) => d.id === `d${i}`)).toBe(true);
    }
    expect(list.find((d) => d.id === "d12")?.title).toBe("Imported 12");
  });

  it("skips malformed documents in the backup", () => {
    const storage = new MemoryStorage();
    seedDocuments(storage, [doc("keep", 10)]);
    importBackup(
      backupWith({
        documents: [
          doc("good", 20),
          null,
          "x",
          { id: 1 },
          { ...doc("bad-source", 30), source: "bogus" },
          { ...doc("keep", 40), title: 7 },
        ],
      }),
      storage,
    );
    const list = listDocuments(storage);
    expect(list.map((d) => d.id)).toEqual(["good", "keep"]);
    expect(list.find((d) => d.id === "keep")).toEqual(doc("keep", 10));
  });

  it("reads backed-up documents without a note as an empty note", () => {
    const storage = new MemoryStorage();
    const noNote: Partial<SavedDocument> = doc("old", 5);
    delete noNote.note;
    importBackup(backupWith({ documents: [noNote] }), storage);
    expect(listDocuments(storage)).toEqual([doc("old", 5)]);
  });
});

describe("importBackup settings", () => {
  it("replaces the stored settings with the backup's settings", () => {
    const storage = new MemoryStorage();
    saveSettings({ ...DEFAULT_SETTINGS, theme: "dark", fontSize: 60 }, storage);
    importBackup(backupWith({ settings: customSettings }), storage);
    expect(loadSettings(storage)).toEqual(customSettings);
  });

  it("sanitizes bad settings before storing them", () => {
    const storage = new MemoryStorage();
    importBackup(
      backupWith({
        settings: {
          theme: "neon",
          fontSize: 1000,
          lineHeight: 0,
          rate: "fast",
          volume: -3,
          fontFamily: "mono",
          voiceURI: 12,
          autoScroll: "yes",
          extra: "ignored",
        },
      }),
      storage,
    );
    const expected: ReaderSettings = {
      ...DEFAULT_SETTINGS,
      fontSize: 96,
      lineHeight: 1.2,
      volume: 0,
      fontFamily: "mono",
    };
    // The raw stored value is already clean, not only what loadSettings returns.
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual(expected);
    expect(loadSettings(storage)).toEqual(expected);
  });

  it("stores default settings when the backup's settings are not an object", () => {
    const storage = new MemoryStorage();
    importBackup(backupWith({ settings: "nope" }), storage);
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("importBackup with invalid input", () => {
  function seeded(): { storage: MemoryStorage; snapshot: () => unknown } {
    const storage = new MemoryStorage();
    saveDocument({ title: "A", text: "Alpha.", source: "paste" }, storage);
    saveSettings(customSettings, storage);
    const snapshot = () => ({
      docs: storage.getItem(DOCUMENTS_STORAGE_KEY),
      settings: storage.getItem(SETTINGS_STORAGE_KEY),
      length: storage.length,
    });
    return { storage, snapshot };
  }

  it("throws an Error with a clear message on invalid JSON and changes nothing", () => {
    for (const bad of ["{oops", "", "not json", '{"documents": [', "undefined"]) {
      const { storage, snapshot } = seeded();
      const before = snapshot();
      const writes = storage.writes;
      let error: unknown;
      try {
        importBackup(bad, storage);
      } catch (e) {
        error = e;
      }
      expect(error, `input ${JSON.stringify(bad)}`).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/backup|json/i);
      expect(snapshot()).toEqual(before);
      expect(storage.writes).toBe(writes);
    }
  });

  it("throws and changes nothing when the JSON is not a backup object", () => {
    for (const bad of ["null", "42", '"text"', "[]", "true"]) {
      const { storage, snapshot } = seeded();
      const before = snapshot();
      const writes = storage.writes;
      expect(() => importBackup(bad, storage), `input ${bad}`).toThrow(Error);
      expect(snapshot()).toEqual(before);
      expect(storage.writes).toBe(writes);
    }
  });
});
