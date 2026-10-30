import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "@/tests/fakes/storage";
import {
  DOCUMENTS_STORAGE_KEY,
  TITLE_MAX_LENGTH,
  MAX_DOCUMENTS,
  NOTE_MAX_LENGTH,
  NOTE_PREVIEW_LENGTH,
  deleteDocument,
  deriveTitle,
  getDocument,
  listDocuments,
  notePreview,
  saveDocument,
  updateNote,
  updateProgress,
} from "./documents";

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

describe("document store", () => {
  it("saves and retrieves a document", () => {
    const doc = saveDocument({ title: "My doc", text: "Hello world.", source: "paste" }, storage);
    expect(doc).toMatchObject({
      title: "My doc",
      text: "Hello world.",
      source: "paste",
      createdAt: now,
      updatedAt: now,
      lastSentenceIndex: 0,
      note: "",
    });
    expect(typeof doc.id).toBe("string");
    expect(doc.id.length).toBeGreaterThan(0);
    expect(getDocument(doc.id, storage)).toEqual(doc);
    expect(getDocument("missing", storage)).toBeNull();
    expect(storage.getItem(DOCUMENTS_STORAGE_KEY)).toContain("Hello world.");
  });

  it("derives a title when none is given", () => {
    const doc = saveDocument({ title: "  ", text: "First sentence. Second.", source: "file" }, storage);
    expect(doc.title).toBe("First sentence.");
  });

  it("tidies titles by trimming and collapsing whitespace", () => {
    const doc = saveDocument({ title: "  My   doc  ", text: "Hello world.", source: "paste" }, storage);
    expect(doc.title).toBe("My doc");
  });

  it("handles titles that are only whitespace", () => {
    const doc = saveDocument({ title: "   ", text: "First sentence.", source: "file" }, storage);
    expect(doc.title).toBe("First sentence.");
  });

  it("cuts long titles at TITLE_MAX_LENGTH after tidying", () => {
    const longTitle = "This is a very long title that goes on and on and on and extends well past the sixty character limit.";
    const doc = saveDocument({ title: longTitle, text: "Content.", source: "paste" }, storage);
    expect(doc.title.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
    expect(doc.title).toContain("…");
  });

  it("lists newest first", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    tick();
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    tick();
    const c = saveDocument({ title: "C", text: "c", source: "paste" }, storage);
    expect(listDocuments(storage).map((d) => d.id)).toEqual([c.id, b.id, a.id]);
  });

  it("keeps newest first even with identical timestamps", () => {
    saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    expect(listDocuments(storage)[0].id).toBe(b.id);
  });

  it("caps at 20 entries, dropping the oldest", () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push(saveDocument({ title: `D${i}`, text: `text ${i}`, source: "paste" }, storage).id);
      tick();
    }
    const list = listDocuments(storage);
    expect(list).toHaveLength(20);
    expect(list[0].id).toBe(ids[24]);
    expect(list[19].id).toBe(ids[5]);
    expect(list.some((d) => d.id === ids[4])).toBe(false);
  });

  it("does not duplicate identical text; updates the existing entry", () => {
    const first = saveDocument({ title: "Old", text: "Same text.", source: "paste" }, storage);
    updateProgress(first.id, 3, storage);
    tick();
    const other = saveDocument({ title: "Other", text: "Different.", source: "paste" }, storage);
    tick();
    const again = saveDocument({ title: "New", text: "Same text.", source: "file" }, storage);
    expect(again.id).toBe(first.id);
    expect(again.title).toBe("New");
    expect(again.source).toBe("file");
    expect(again.createdAt).toBe(first.createdAt);
    expect(again.updatedAt).toBe(now);
    expect(again.lastSentenceIndex).toBe(3);
    const list = listDocuments(storage);
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.id)).toEqual([first.id, other.id]);
  });

  it("updates progress and moves the document to the top", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    tick();
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    tick();
    updateProgress(a.id, 7, storage);
    expect(getDocument(a.id, storage)?.lastSentenceIndex).toBe(7);
    expect(listDocuments(storage).map((d) => d.id)).toEqual([a.id, b.id]);
    expect(() => updateProgress("missing", 1, storage)).not.toThrow();
    updateProgress(a.id, -4, storage);
    expect(getDocument(a.id, storage)?.lastSentenceIndex).toBe(0);
  });

  it("deletes documents", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    deleteDocument(a.id, storage);
    expect(listDocuments(storage).map((d) => d.id)).toEqual([b.id]);
    expect(() => deleteDocument("missing", storage)).not.toThrow();
  });

  it("ignores corrupt or malformed stored data", () => {
    storage.setItem(DOCUMENTS_STORAGE_KEY, "{oops");
    expect(listDocuments(storage)).toEqual([]);
    storage.setItem(
      DOCUMENTS_STORAGE_KEY,
      JSON.stringify([{ id: 1 }, null, "x", { id: "ok", title: "t", text: "x", source: "bogus" }]),
    );
    expect(listDocuments(storage)).toEqual([]);
    const doc = saveDocument({ title: "A", text: "a", source: "pdf" }, storage);
    expect(listDocuments(storage)).toEqual([doc]);
  });

  it("never throws when storage fails", () => {
    const ok = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    storage.failWrites = true;
    let doc: ReturnType<typeof saveDocument> | undefined;
    expect(() => {
      doc = saveDocument({ title: "B", text: "b", source: "url" }, storage);
    }).not.toThrow();
    expect(doc?.title).toBe("B");
    expect(() => updateProgress(ok.id, 2, storage)).not.toThrow();
    expect(() => deleteDocument(ok.id, storage)).not.toThrow();

    storage.failReads = true;
    expect(listDocuments(storage)).toEqual([]);
    expect(getDocument(ok.id, storage)).toBeNull();
    expect(() => saveDocument({ title: "C", text: "c", source: "image" }, storage)).not.toThrow();
    expect(() => updateProgress(ok.id, 2, storage)).not.toThrow();
    expect(() => deleteDocument(ok.id, storage)).not.toThrow();
  });
});

describe("document notes", () => {
  it("new documents start with an empty note", () => {
    const doc = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    expect(doc.note).toBe("");
    expect(getDocument(doc.id, storage)?.note).toBe("");
    expect(listDocuments(storage)[0].note).toBe("");
  });

  it("stores a note, returns the updated doc and moves it to the top", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    tick();
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    tick();
    const note = "  Remember:\n  chapter 3 is key.  ";
    const updated = updateNote(a.id, note, storage);
    expect(updated).toMatchObject({ id: a.id, note, updatedAt: now, createdAt: a.createdAt });
    expect(getDocument(a.id, storage)).toEqual(updated);
    expect(listDocuments(storage).map((d) => d.id)).toEqual([a.id, b.id]);
    expect(listDocuments(storage)[0].note).toBe(note);
    expect(storage.getItem(DOCUMENTS_STORAGE_KEY)).toContain("chapter 3 is key.");
  });

  it("can clear a note", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    updateNote(a.id, "something", storage);
    expect(updateNote(a.id, "", storage)?.note).toBe("");
    expect(getDocument(a.id, storage)?.note).toBe("");
  });

  it("truncates notes to NOTE_MAX_LENGTH", () => {
    expect(NOTE_MAX_LENGTH).toBe(10_000);
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    const updated = updateNote(a.id, "y".repeat(NOTE_MAX_LENGTH + 500), storage);
    expect(updated?.note).toHaveLength(NOTE_MAX_LENGTH);
    expect(getDocument(a.id, storage)?.note).toHaveLength(NOTE_MAX_LENGTH);
    const exact = "z".repeat(NOTE_MAX_LENGTH);
    expect(updateNote(a.id, exact, storage)?.note).toBe(exact);
  });

  it("returns null for unknown ids and does not write", () => {
    saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    const writes = storage.writes;
    expect(updateNote("missing", "note", storage)).toBeNull();
    expect(storage.writes).toBe(writes);
  });

  it("keeps the note when re-saving identical text", () => {
    const first = saveDocument({ title: "Old", text: "Same text.", source: "paste" }, storage);
    updateNote(first.id, "my note", storage);
    tick();
    const again = saveDocument({ title: "New", text: "Same text.", source: "file" }, storage);
    expect(again.id).toBe(first.id);
    expect(again.note).toBe("my note");
    expect(getDocument(first.id, storage)?.note).toBe("my note");
  });

  it("reads old v1 data without a note (or a non-string note) as an empty note", () => {
    const base = {
      title: "Old",
      text: "old text",
      source: "paste",
      createdAt: 1,
      updatedAt: 2,
      lastSentenceIndex: 4,
    };
    storage.setItem(
      DOCUMENTS_STORAGE_KEY,
      JSON.stringify([
        { ...base, id: "no-note" },
        { ...base, id: "num-note", text: "other", updatedAt: 1, note: 42 },
        { ...base, id: "null-note", text: "third", updatedAt: 0, note: null },
      ]),
    );
    const list = listDocuments(storage);
    expect(list.map((d) => d.id)).toEqual(["no-note", "num-note", "null-note"]);
    expect(list.every((d) => d.note === "")).toBe(true);
    expect(getDocument("no-note", storage)).toEqual({ ...base, id: "no-note", note: "" });

    const updated = updateNote("no-note", "now with a note", storage);
    expect(updated).toMatchObject({ ...base, id: "no-note", note: "now with a note", updatedAt: now });
    expect(listDocuments(storage)).toHaveLength(3);
  });

  it("still rejects otherwise invalid documents that have a note", () => {
    storage.setItem(
      DOCUMENTS_STORAGE_KEY,
      JSON.stringify([{ id: "x", title: "t", text: "x", source: "bogus", note: "hi" }]),
    );
    expect(listDocuments(storage)).toEqual([]);
  });

  it("removes the note from storage when the document is deleted", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    updateNote(a.id, "secret-note-a", storage);
    updateNote(b.id, "note-b", storage);
    deleteDocument(a.id, storage);
    const raw = storage.getItem(DOCUMENTS_STORAGE_KEY) ?? "";
    expect(raw).not.toContain("secret-note-a");
    expect(raw).toContain("note-b");
    expect(getDocument(a.id, storage)).toBeNull();
  });

  it("drops the note with the document when the cap evicts it", () => {
    const oldest = saveDocument({ title: "Old", text: "oldest", source: "paste" }, storage);
    updateNote(oldest.id, "evicted-note", storage);
    for (let i = 0; i < MAX_DOCUMENTS; i++) {
      tick();
      saveDocument({ title: `D${i}`, text: `text ${i}`, source: "paste" }, storage);
    }
    expect(listDocuments(storage)).toHaveLength(MAX_DOCUMENTS);
    expect(getDocument(oldest.id, storage)).toBeNull();
    expect(storage.getItem(DOCUMENTS_STORAGE_KEY)).not.toContain("evicted-note");
  });

  it("updateNote never throws when writes fail", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    storage.failWrites = true;
    let result: ReturnType<typeof updateNote> = null;
    expect(() => {
      result = updateNote(a.id, "unsaved", storage);
    }).not.toThrow();
    expect(result).toMatchObject({ id: a.id, note: "unsaved" });
    expect(getDocument(a.id, storage)?.note).toBe("");
    expect(() => updateNote("missing", "x", storage)).not.toThrow();
  });

  it("updateNote never throws when reads fail", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    storage.failReads = true;
    let result: ReturnType<typeof updateNote> = null;
    expect(() => {
      result = updateNote(a.id, "note", storage);
    }).not.toThrow();
    expect(result).toBeNull();
  });
});

describe("notePreview", () => {
  it("collapses whitespace and returns short notes unchanged", () => {
    expect(notePreview("  Hello\n\n   world \t ")).toBe("Hello world");
    expect(notePreview("Short note.")).toBe("Short note.");
  });

  it("returns an empty string for blank notes", () => {
    expect(notePreview("")).toBe("");
    expect(notePreview("   \n\t ")).toBe("");
  });

  it("cuts long notes at a word boundary with an ellipsis", () => {
    expect(NOTE_PREVIEW_LENGTH).toBe(80);
    const note =
      "This note is deliberately long so that it goes well past the eighty character preview limit, really.";
    const preview = notePreview(note);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(81);
    const body = preview.slice(0, -1);
    expect(note.startsWith(body)).toBe(true);
    expect(note[body.length]).toMatch(/[\s,]/);
    expect(preview).toBe(
      "This note is deliberately long so that it goes well past the eighty character…",
    );
  });

  it("strips trailing punctuation before the ellipsis", () => {
    expect(notePreview("one two, three four", 10)).toBe("one two…");
  });

  it("respects a custom max", () => {
    expect(notePreview("alpha beta gamma delta", 12)).toBe("alpha beta…");
  });

  it("hard-cuts a single very long word", () => {
    expect(notePreview("x".repeat(200))).toBe(`${"x".repeat(80)}…`);
  });
});

describe("deriveTitle", () => {
  it("uses the first sentence when short", () => {
    expect(deriveTitle("Short title. And more text follows here.")).toBe("Short title.");
  });

  it("cuts long sentences at a word boundary with an ellipsis", () => {
    const text =
      "This is a rather long first sentence that keeps going well past the sixty character limit. Next.";
    const title = deriveTitle(text);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    const body = title.slice(0, -1);
    expect(text.startsWith(body)).toBe(true);
    expect(text[body.length]).toBe(" ");
    expect(title).toBe("This is a rather long first sentence that keeps going well…");
  });

  it("collapses whitespace and handles empty text", () => {
    expect(deriveTitle("  Hello\n\n   world  ")).toBe("Hello world");
    expect(deriveTitle("   ")).toBe("Untitled");
  });

  it("hard-cuts a single very long word", () => {
    const title = deriveTitle("x".repeat(100));
    expect(title).toBe(`${"x".repeat(60)}…`);
  });
});
