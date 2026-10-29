import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "@/tests/fakes/storage";
import {
  DOCUMENTS_STORAGE_KEY,
  MAX_DOCUMENTS,
  NOTE_MAX_LENGTH,
  NOTE_PREVIEW_LENGTH,
  TITLE_MAX_LENGTH,
  deleteDocument,
  deriveTitle,
  getDocument,
  listDocuments,
  notePreview,
  renameDocument,
  saveDocument,
  searchDocuments,
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

describe("searchDocuments", () => {
  function ids(docs: { id: string }[]): string[] {
    return docs.map((d) => d.id);
  }

  it("matches the title, ignoring case", () => {
    const a = saveDocument({ title: "The Quick Fox", text: "nothing here", source: "paste" }, storage);
    tick();
    saveDocument({ title: "Other", text: "unrelated", source: "paste" }, storage);
    expect(ids(searchDocuments("quick fox", storage))).toEqual([a.id]);
    expect(ids(searchDocuments("QUICK", storage))).toEqual([a.id]);
  });

  it("matches the text, ignoring case", () => {
    const a = saveDocument({ title: "Alpha", text: "The Lazy Dog sleeps.", source: "paste" }, storage);
    tick();
    saveDocument({ title: "Beta", text: "unrelated", source: "paste" }, storage);
    expect(ids(searchDocuments("lazy DOG", storage))).toEqual([a.id]);
  });

  it("matches the note, ignoring case", () => {
    const a = saveDocument({ title: "Alpha", text: "aaa", source: "paste" }, storage);
    tick();
    saveDocument({ title: "Beta", text: "bbb", source: "paste" }, storage);
    tick();
    updateNote(a.id, "Remember CHAPTER three", storage);
    expect(ids(searchDocuments("chapter", storage))).toEqual([a.id]);
  });

  it("matches substrings inside words", () => {
    const a = saveDocument({ title: "Foxglove", text: "aaa", source: "paste" }, storage);
    expect(ids(searchDocuments("oxgl", storage))).toEqual([a.id]);
  });

  it("puts title matches before text and note matches, each group newest first", () => {
    const textOld = saveDocument({ title: "One", text: "a banana split", source: "paste" }, storage);
    tick();
    const titleOld = saveDocument({ title: "Banana bread", text: "flour", source: "paste" }, storage);
    tick();
    const noteDoc = saveDocument({ title: "Two", text: "sugar", source: "paste" }, storage);
    tick();
    const textNew = saveDocument({ title: "Three", text: "BANANA milk", source: "paste" }, storage);
    tick();
    const titleNew = saveDocument({ title: "More bananas", text: "salt", source: "paste" }, storage);
    tick();
    saveDocument({ title: "Four", text: "apple", source: "paste" }, storage);
    tick();
    updateNote(noteDoc.id, "buy banana", storage); // now the most recently updated
    tick();
    const titleNewest = saveDocument({ title: "Last banana", text: "pepper", source: "paste" }, storage);

    expect(ids(searchDocuments("banana", storage))).toEqual([
      titleNewest.id,
      titleNew.id,
      titleOld.id,
      noteDoc.id,
      textNew.id,
      textOld.id,
    ]);
  });

  it("lists a document only once when it matches in several fields, in the title group", () => {
    const both = saveDocument({ title: "Moon", text: "the moon is bright", source: "paste" }, storage);
    updateNote(both.id, "moon note", storage);
    tick();
    const textOnly = saveDocument({ title: "Night", text: "full moon", source: "paste" }, storage);
    const result = searchDocuments("moon", storage);
    expect(ids(result)).toEqual([both.id, textOnly.id]);
  });

  it("returns whole documents", () => {
    const a = saveDocument({ title: "Alpha", text: "aaa", source: "file" }, storage);
    const updated = updateNote(a.id, "n", storage);
    expect(searchDocuments("alpha", storage)).toEqual([updated]);
  });

  it("returns every document, newest first, for an empty query", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    tick();
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    tick();
    const c = saveDocument({ title: "C", text: "c", source: "paste" }, storage);
    expect(ids(searchDocuments("", storage))).toEqual([c.id, b.id, a.id]);
    expect(searchDocuments("", storage)).toEqual(listDocuments(storage));
  });

  it("returns every document for a whitespace-only query", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    tick();
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    expect(ids(searchDocuments("   ", storage))).toEqual([b.id, a.id]);
    expect(ids(searchDocuments(" \n\t ", storage))).toEqual([b.id, a.id]);
  });

  it("returns an empty list when nothing matches", () => {
    saveDocument({ title: "Alpha", text: "aaa", source: "paste" }, storage);
    saveDocument({ title: "Beta", text: "bbb", source: "paste" }, storage);
    expect(searchDocuments("zebra", storage)).toEqual([]);
  });

  it("returns an empty list when there are no documents", () => {
    expect(searchDocuments("", storage)).toEqual([]);
    expect(searchDocuments("anything", storage)).toEqual([]);
  });

  it("treats the query literally, not as a pattern", () => {
    const dotted = saveDocument({ title: "v1.2 notes", text: "aaa", source: "paste" }, storage);
    tick();
    saveDocument({ title: "v1x2 notes", text: "bbb", source: "paste" }, storage);
    tick();
    const paren = saveDocument({ title: "Plain", text: "call f(x) here", source: "paste" }, storage);
    expect(ids(searchDocuments("1.2", storage))).toEqual([dotted.id]);
    expect(ids(searchDocuments("f(x", storage))).toEqual([paren.id]);
    expect(() => searchDocuments("[(*", storage)).not.toThrow();
    expect(searchDocuments("[(*", storage)).toEqual([]);
  });

  it("finds old stored documents that have no note", () => {
    storage.setItem(
      DOCUMENTS_STORAGE_KEY,
      JSON.stringify([
        { id: "old", title: "Old doc", text: "legacy text", source: "paste", createdAt: 1, updatedAt: 2, lastSentenceIndex: 0 },
      ]),
    );
    expect(ids(searchDocuments("legacy", storage))).toEqual(["old"]);
    expect(searchDocuments("nothing", storage)).toEqual([]);
  });

  it("does not write to storage", () => {
    saveDocument({ title: "Alpha", text: "aaa", source: "paste" }, storage);
    const writes = storage.writes;
    searchDocuments("alpha", storage);
    searchDocuments("", storage);
    expect(storage.writes).toBe(writes);
  });

  it("never throws when reads fail", () => {
    saveDocument({ title: "Alpha", text: "aaa", source: "paste" }, storage);
    storage.failReads = true;
    expect(() => searchDocuments("alpha", storage)).not.toThrow();
    expect(searchDocuments("alpha", storage)).toEqual([]);
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

describe("saveDocument titles", () => {
  it("tidies a given title before saving", () => {
    expect(saveDocument({ title: "  My   doc  ", text: "a", source: "paste" }, storage).title).toBe("My doc");
  });

  it("falls back to the derived title when the given one is only whitespace", () => {
    expect(saveDocument({ title: " \n\t ", text: "Hello world. More.", source: "paste" }, storage).title).toBe("Hello world.");
  });

  it("cuts a long given title the way deriveTitle cuts: at a word boundary, else 60 characters, then …", () => {
    expect(saveDocument({ title: "x".repeat(70), text: "b", source: "paste" }, storage).title).toBe(`${"x".repeat(60)}…`);
    const words = "word ".repeat(20);
    expect(saveDocument({ title: words, text: "c", source: "paste" }, storage).title).toBe(deriveTitle(words));
    expect(saveDocument({ title: "Dr. Who and the long title that goes on", text: "d", source: "paste" }, storage).title).toBe("Dr. Who and the long title that goes on");
  });
});

describe("renameDocument", () => {
  it("renames a document, returns the updated doc and keeps everything else", () => {
    const a = saveDocument({ title: "Old title", text: "Some text. More.", source: "file" }, storage);
    updateProgress(a.id, 3, storage);
    updateNote(a.id, "my note", storage);
    const before = getDocument(a.id, storage)!;
    tick();
    const updated = renameDocument(a.id, "New title", storage);
    expect(updated).toMatchObject({
      id: a.id,
      title: "New title",
      text: before.text,
      source: before.source,
      createdAt: before.createdAt,
      lastSentenceIndex: 3,
      note: "my note",
    });
    expect(getDocument(a.id, storage)).toEqual(updated);
    expect(storage.getItem(DOCUMENTS_STORAGE_KEY)).toContain("New title");
    expect(storage.getItem(DOCUMENTS_STORAGE_KEY)).not.toContain("Old title");
  });

  it("only renames the given document", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    tick();
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    renameDocument(a.id, "Renamed A", storage);
    expect(getDocument(a.id, storage)?.title).toBe("Renamed A");
    expect(getDocument(b.id, storage)?.title).toBe("B");
    expect(listDocuments(storage)).toHaveLength(2);
  });

  it("trims and tidies whitespace in the new title", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    expect(renameDocument(a.id, "   My   new\ttitle  \n", storage)?.title).toBe("My new title");
    expect(getDocument(a.id, storage)?.title).toBe("My new title");
  });

  it("does not save an empty or whitespace-only title: returns null and does not write", () => {
    const a = saveDocument({ title: "Keep me", text: "a", source: "paste" }, storage);
    const writes = storage.writes;
    expect(renameDocument(a.id, "", storage)).toBeNull();
    expect(renameDocument(a.id, "   \n\t ", storage)).toBeNull();
    expect(storage.writes).toBe(writes);
    expect(getDocument(a.id, storage)?.title).toBe("Keep me");
  });

  it("returns null for unknown ids and does not write", () => {
    saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    const writes = storage.writes;
    expect(renameDocument("missing", "New", storage)).toBeNull();
    expect(storage.writes).toBe(writes);
  });

  it("respects TITLE_MAX_LENGTH, cutting long titles the way saveDocument does", () => {
    expect(TITLE_MAX_LENGTH).toBe(60);
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    const exact = "e".repeat(TITLE_MAX_LENGTH);
    expect(renameDocument(a.id, exact, storage)?.title).toBe(exact);
    expect(renameDocument(a.id, "x".repeat(TITLE_MAX_LENGTH + 1), storage)?.title).toBe(
      `${"x".repeat(TITLE_MAX_LENGTH)}…`,
    );
    expect(getDocument(a.id, storage)?.title).toBe(`${"x".repeat(TITLE_MAX_LENGTH)}…`);
    const words = "word ".repeat(20);
    expect(renameDocument(a.id, words, storage)?.title).toBe(deriveTitle(words));
    expect(saveDocument({ title: words, text: "other", source: "paste" }, storage).title).toBe(
      renameDocument(a.id, words, storage)?.title,
    );
  });

  it("never throws when writes fail", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    storage.failWrites = true;
    expect(() => renameDocument(a.id, "Unsaved", storage)).not.toThrow();
    expect(getDocument(a.id, storage)?.title).toBe("A");
    expect(() => renameDocument("missing", "x", storage)).not.toThrow();
  });

  it("never throws when reads fail", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    storage.failReads = true;
    let result: ReturnType<typeof renameDocument> = null;
    expect(() => {
      result = renameDocument(a.id, "New", storage);
    }).not.toThrow();
    expect(result).toBeNull();
  });
});
