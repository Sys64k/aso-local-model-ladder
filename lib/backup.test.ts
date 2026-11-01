import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "@/tests/fakes/storage";
import { exportBackup, importBackup } from "./backup";
import {
  DOCUMENTS_STORAGE_KEY,
  MAX_DOCUMENTS,
  type SavedDocument,
  getDocument,
  listDocuments,
  saveDocument,
  updateNote,
  updateProgress,
} from "./documents";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  saveSettings,
} from "./settings";

let storage: MemoryStorage;
let now: number;

beforeEach(() => {
  storage = new MemoryStorage();
  now = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function tick(ms = 1000) {
  now += ms;
}

function doc(id: string, updatedAt: number, extra: Partial<SavedDocument> = {}): SavedDocument {
  return {
    id,
    title: `Title ${id}`,
    text: `Text of ${id}.`,
    source: "paste",
    createdAt: updatedAt,
    updatedAt,
    lastSentenceIndex: 0,
    note: "",
    ...extra,
  };
}

/** Writes documents straight into storage, as the documents module stores them. */
function seedDocuments(target: MemoryStorage, docs: SavedDocument[]) {
  target.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(docs));
}

/** A backup in the documented shape: `{ documents: [...], settings: {...} }`. */
function backup(documents: unknown[], settings: unknown = DEFAULT_SETTINGS): string {
  return JSON.stringify({ documents, settings });
}

function snapshot(target: MemoryStorage) {
  return {
    documents: target.getItem(DOCUMENTS_STORAGE_KEY),
    settings: target.getItem(SETTINGS_STORAGE_KEY),
    writes: target.writes,
  };
}

describe("exportBackup", () => {
  it("returns a JSON string with every saved document and the settings", () => {
    const a = saveDocument({ title: "A", text: "Alpha text.", source: "paste" }, storage);
    tick();
    const b = saveDocument({ title: "B", text: "Beta text.", source: "pdf" }, storage);
    updateNote(b.id, "a note on b", storage);
    tick();
    updateProgress(a.id, 5, storage);
    const settings = { ...DEFAULT_SETTINGS, theme: "dark" as const, fontSize: 40, voiceURI: "v1" };
    saveSettings(settings, storage);

    const json = exportBackup(storage);
    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json);
    expect(parsed).toBeTypeOf("object");
    expect(Array.isArray(parsed.documents)).toBe(true);
    expect(parsed.documents).toHaveLength(2);
    expect(parsed.documents).toEqual(expect.arrayContaining(listDocuments(storage)));
    expect(parsed.settings).toEqual(settings);
  });

  it("exports an empty document list and default settings from empty storage", () => {
    const parsed = JSON.parse(exportBackup(storage));
    expect(parsed.documents).toEqual([]);
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("does not write to storage", () => {
    saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    saveSettings({ ...DEFAULT_SETTINGS, rate: 1.5 }, storage);
    const before = snapshot(storage);
    exportBackup(storage);
    expect(snapshot(storage)).toEqual(before);
  });
});

describe("importBackup", () => {
  it("round-trips: export then import into empty storage gives the same documents and settings", () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(saveDocument({ title: `D${i}`, text: `text ${i}.`, source: "file" }, storage).id);
      tick();
    }
    updateNote(ids[1], "  keep\n this note  ", storage);
    tick();
    updateProgress(ids[3], 12, storage);
    const settings = {
      ...DEFAULT_SETTINGS,
      theme: "sepia" as const,
      fontFamily: "mono" as const,
      rate: 1.5,
      autoScroll: false,
      viewMode: "focus" as const,
    };
    saveSettings(settings, storage);

    const json = exportBackup(storage);
    const target = new MemoryStorage();
    importBackup(json, target);

    expect(listDocuments(target)).toEqual(listDocuments(storage));
    expect(loadSettings(target)).toEqual(settings);
    expect(getDocument(ids[1], target)?.note).toBe("  keep\n this note  ");
    expect(getDocument(ids[3], target)?.lastSentenceIndex).toBe(12);
    // Exporting the restored storage gives an equivalent backup.
    expect(JSON.parse(exportBackup(target))).toEqual(JSON.parse(json));
  });

  it("round-trips an empty backup", () => {
    const json = exportBackup(storage);
    const target = new MemoryStorage();
    importBackup(json, target);
    expect(listDocuments(target)).toEqual([]);
    expect(loadSettings(target)).toEqual(DEFAULT_SETTINGS);
  });

  it("merges documents by id, keeping existing ones that are not in the backup", () => {
    seedDocuments(storage, [doc("a", 300), doc("b", 200)]);
    importBackup(backup([doc("c", 250), doc("d", 100)]), storage);
    expect(listDocuments(storage).map((d) => d.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("lets the imported document win when the id already exists", () => {
    seedDocuments(storage, [
      doc("a", 500, { title: "Local A", note: "local note", lastSentenceIndex: 9 }),
      doc("b", 400),
    ]);
    // The imported copy is older than the local one, but still replaces it.
    const imported = doc("a", 100, { title: "Imported A", note: "imported note", lastSentenceIndex: 2 });
    importBackup(backup([imported]), storage);

    const list = listDocuments(storage);
    expect(list).toHaveLength(2);
    expect(list.filter((d) => d.id === "a")).toHaveLength(1);
    expect(getDocument("a", storage)).toEqual(imported);
    expect(list.map((d) => d.id)).toEqual(["b", "a"]);
  });

  it("keeps at most MAX_DOCUMENTS, dropping the oldest", () => {
    expect(MAX_DOCUMENTS).toBe(20);
    // 15 local docs at even timestamps, 10 imported at odd timestamps: 25 in total.
    const local = Array.from({ length: 15 }, (_, i) => doc(`local-${i}`, 1000 + i * 2));
    const imported = Array.from({ length: 10 }, (_, i) => doc(`imp-${i}`, 1001 + i * 2));
    seedDocuments(storage, local);
    importBackup(backup(imported), storage);

    const all = [...local, ...imported].sort((x, y) => y.updatedAt - x.updatedAt);
    const expected = all.slice(0, MAX_DOCUMENTS).map((d) => d.id);
    const list = listDocuments(storage);
    expect(list).toHaveLength(MAX_DOCUMENTS);
    expect(list.map((d) => d.id)).toEqual(expected);
    // The five oldest are gone from storage entirely.
    const raw = storage.getItem(DOCUMENTS_STORAGE_KEY) ?? "";
    for (const dropped of all.slice(MAX_DOCUMENTS)) {
      expect(raw).not.toContain(`"${dropped.id}"`);
    }
    expect(JSON.parse(raw)).toHaveLength(MAX_DOCUMENTS);
  });

  it("keeps all documents when the merged total is exactly MAX_DOCUMENTS", () => {
    const local = Array.from({ length: 12 }, (_, i) => doc(`local-${i}`, 100 + i));
    const imported = Array.from({ length: 8 }, (_, i) => doc(`imp-${i}`, 500 + i));
    seedDocuments(storage, local);
    importBackup(backup(imported), storage);
    expect(listDocuments(storage)).toHaveLength(MAX_DOCUMENTS);
  });

  it("counts a merged id once toward the cap", () => {
    // 20 local + 1 imported that replaces an existing id = still 20, nothing dropped.
    const local = Array.from({ length: MAX_DOCUMENTS }, (_, i) => doc(`d-${i}`, 100 + i));
    seedDocuments(storage, local);
    importBackup(backup([doc("d-0", 50, { title: "Replaced" })]), storage);
    const list = listDocuments(storage);
    expect(list).toHaveLength(MAX_DOCUMENTS);
    expect(getDocument("d-0", storage)?.title).toBe("Replaced");
  });

  it("caps a backup that alone holds more than MAX_DOCUMENTS", () => {
    const imported = Array.from({ length: 30 }, (_, i) => doc(`imp-${i}`, 100 + i));
    importBackup(backup(imported), storage);
    const list = listDocuments(storage);
    expect(list).toHaveLength(MAX_DOCUMENTS);
    expect(list[0].id).toBe("imp-29");
    expect(list[MAX_DOCUMENTS - 1].id).toBe("imp-10");
  });

  it("restores the settings from the backup, replacing the current ones", () => {
    saveSettings({ ...DEFAULT_SETTINGS, theme: "dark", fontSize: 60 }, storage);
    const settings = { ...DEFAULT_SETTINGS, theme: "high-contrast" as const, pitch: 0.5 };
    importBackup(backup([], settings), storage);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it("sanitizes bad settings in a backup before storing them", () => {
    importBackup(
      backup([], {
        theme: "neon",
        fontSize: 1000,
        lineHeight: 0,
        rate: 1.5,
        fontFamily: "comic-sans",
        voiceURI: 12,
        autoScroll: "yes",
        bogus: "extra",
      }),
      storage,
    );
    const expected = { ...DEFAULT_SETTINGS, fontSize: 96, lineHeight: 1.2, rate: 1.5 };
    // What is written to storage is already sanitized, not just what loadSettings returns.
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual(expected);
    expect(loadSettings(storage)).toEqual(expected);
  });

  it("uses default settings when the backup's settings are not an object", () => {
    importBackup(JSON.stringify({ documents: [], settings: "loud" }), storage);
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual(DEFAULT_SETTINGS);
  });

  it("ignores invalid document entries in a backup", () => {
    seedDocuments(storage, [doc("a", 100)]);
    importBackup(
      backup([
        doc("good", 200),
        { id: 1 },
        null,
        "x",
        { ...doc("bad-source", 300), source: "bogus" },
      ]),
      storage,
    );
    expect(listDocuments(storage).map((d) => d.id)).toEqual(["good", "a"]);
  });

  it("throws a clear Error on invalid JSON and leaves storage unchanged", () => {
    seedDocuments(storage, [doc("a", 100)]);
    saveSettings({ ...DEFAULT_SETTINGS, theme: "dark" }, storage);
    const before = snapshot(storage);

    for (const bad of ["{oops", "", "not json at all", '{"documents": ['] ) {
      let error: unknown;
      try {
        importBackup(bad, storage);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message.trim().length).toBeGreaterThan(0);
      expect(message).toMatch(/backup|json/i);
      expect(snapshot(storage)).toEqual(before);
    }
    expect(listDocuments(storage).map((d) => d.id)).toEqual(["a"]);
    expect(loadSettings(storage).theme).toBe("dark");
  });

  it("throws on JSON that is not a backup object and leaves storage unchanged", () => {
    seedDocuments(storage, [doc("a", 100)]);
    saveSettings({ ...DEFAULT_SETTINGS, theme: "dark" }, storage);
    const before = snapshot(storage);

    for (const bad of ["null", "42", '"text"', "true", "[]"]) {
      expect(() => importBackup(bad, storage)).toThrow(Error);
      expect(snapshot(storage)).toEqual(before);
    }
  });

  it("uses localStorage when no storage is passed", () => {
    window.localStorage.clear();
    try {
      saveDocument({ title: "Local", text: "In local storage.", source: "paste" });
      saveSettings({ ...DEFAULT_SETTINGS, theme: "sepia" });
      const json = exportBackup();
      const parsed = JSON.parse(json);
      expect(parsed.documents).toHaveLength(1);
      expect(parsed.settings.theme).toBe("sepia");

      window.localStorage.clear();
      importBackup(json);
      expect(listDocuments().map((d) => d.title)).toEqual(["Local"]);
      expect(loadSettings().theme).toBe("sepia");
    } finally {
      window.localStorage.clear();
    }
  });
});
