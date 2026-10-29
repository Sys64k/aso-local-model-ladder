import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  DOCUMENTS_STORAGE_KEY,
  TITLE_MAX_LENGTH,
  getDocument,
  listDocuments,
  type SavedDocument,
} from "@/lib/documents";
import { MemoryStorage } from "@/tests/fakes/storage";
import { RecentDocuments } from "./RecentDocuments";

function makeDoc(overrides: Partial<SavedDocument> = {}): SavedDocument {
  return {
    id: "doc-1",
    title: "My letter",
    text: "Dear friend. Hello there.",
    source: "paste",
    createdAt: Date.UTC(2024, 0, 1),
    updatedAt: Date.UTC(2024, 0, 2),
    lastSentenceIndex: 0,
    note: "",
    ...overrides,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderList(documents: SavedDocument[]) {
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  render(<RecentDocuments documents={documents} onOpen={onOpen} onDelete={onDelete} />);
  return { onOpen, onDelete };
}

describe("RecentDocuments note preview", () => {
  it("shows a preview for a document with a note", () => {
    renderList([makeDoc({ note: "Call the bank on Monday" })]);
    const preview = screen.getByTestId("note-preview");
    expect(preview).toHaveTextContent("Note: Call the bank on Monday");
    const openButton = screen.getByRole("button", { name: /^My letter/ });
    expect(within(openButton).getByTestId("note-preview")).toBe(preview);
  });

  it("collapses multi-line notes into a single line", () => {
    renderList([makeDoc({ note: "First line\n\nSecond   line" })]);
    expect(screen.getByTestId("note-preview").textContent).toBe("Note: First line Second line");
  });

  it("shows no preview for blank or whitespace-only notes", () => {
    renderList([
      makeDoc({ id: "a", title: "Blank note", note: "" }),
      makeDoc({ id: "b", title: "Spaces note", note: "   \n\t  " }),
    ]);
    expect(screen.queryByTestId("note-preview")).not.toBeInTheDocument();
    for (const title of ["Blank note", "Spaces note"]) {
      const button = screen.getByRole("button", { name: new RegExp(`^${title}`) });
      expect(button).not.toHaveTextContent("Note:");
      expect(button.querySelectorAll("span")).toHaveLength(2);
    }
  });

  it("truncates long notes with an ellipsis", () => {
    const longNote = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    renderList([makeDoc({ note: longNote })]);
    const text = screen.getByTestId("note-preview").textContent ?? "";
    expect(text.startsWith("Note: word0 word1")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    const preview = text.slice("Note: ".length);
    expect(preview.length).toBeLessThanOrEqual(81);
    expect(text).not.toContain("word39");
  });

  it("keeps the title at the start of the open button's accessible name", () => {
    renderList([makeDoc({ title: "Shopping list", note: "Remember milk" })]);
    const button = screen.getByRole("button", { name: /^Shopping list/ });
    expect(button).toHaveAccessibleName(expect.stringMatching(/^Shopping list /));
    expect(button).toHaveAccessibleName(expect.stringContaining("Note: Remember milk"));
    expect(button).toHaveAccessibleName(expect.stringMatching(/\d Note: Remember milk$/));
  });

  it("still calls onOpen and onDelete", async () => {
    const user = userEvent.setup();
    const doc = makeDoc({ note: "Some note" });
    const { onOpen, onDelete } = renderList([doc]);
    await user.click(screen.getByRole("button", { name: new RegExp(`^${escapeRegExp(doc.title)}`) }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(doc);
    await user.click(screen.getByRole("button", { name: "Delete My letter" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(doc);
  });
});

describe("RecentDocuments clear all functionality", () => {
  it("hides the clear all button when there are no documents", () => {
    renderList([]);
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("shows the clear all button when there are documents", () => {
    renderList([makeDoc()]);
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
  });

  it("opens confirmation modal when clear all is clicked", async () => {
    const user = userEvent.setup();
    renderList([makeDoc()]);
    
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    
    expect(screen.getByRole("dialog", { name: "Clear all documents?" })).toBeInTheDocument();
  });

  it("closes modal when Cancel is clicked", async () => {
    const user = userEvent.setup();
    renderList([makeDoc()]);
    
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    
    expect(screen.queryByRole("dialog", { name: "Clear all documents?" })).not.toBeInTheDocument();
  });

  it("clears all documents when Clear all is clicked in confirmation", async () => {
    const user = userEvent.setup();
    renderList([makeDoc({ id: "doc1" }), makeDoc({ id: "doc2" })]);
    
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByRole("dialog", { name: "Clear all documents?" })).toBeInTheDocument();
    
    // Use a more specific selector for the confirmation button
    const clearAllButton = screen.getAllByRole("button", { name: "Clear all" })[1];  // The second one inside the dialog
    await user.click(clearAllButton);
    
    // Check that the modal is closed
    expect(screen.queryByRole("dialog", { name: "Clear all documents?" })).not.toBeInTheDocument();
  });
});

describe("RecentDocuments rename", () => {
  /**
   * Renders the list the way ReaderApp does: documents come from storage and
   * are re-read when the list reports a rename through `onRename`.
   */
  function renderWithStorage(documents: SavedDocument[]) {
    const storage = new MemoryStorage();
    storage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(documents));
    const onRename = vi.fn();
    const onOpen = vi.fn();
    function Harness() {
      const [docs, setDocs] = useState(() => listDocuments(storage));
      return (
        <RecentDocuments
          documents={docs}
          onOpen={onOpen}
          onDelete={vi.fn()}
          storage={storage}
          onRename={(doc: SavedDocument) => {
            onRename(doc);
            setDocs(listDocuments(storage));
          }}
        />
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    return { storage, onRename, onOpen, user };
  }

  function itemFor(title: string): HTMLElement {
    const open = screen.getByRole("button", { name: new RegExp(`^${escapeRegExp(title)}`) });
    const li = open.closest("li");
    if (!li) throw new Error(`no list item for ${title}`);
    return li;
  }

  function renameButton(title: string): HTMLElement {
    return within(itemFor(title)).getByRole("button", { name: /^Rename\b/ });
  }

  async function startRename(user: ReturnType<typeof userEvent.setup>, title: string) {
    const li = itemFor(title);
    await user.click(renameButton(title));
    return within(li).getByRole("textbox");
  }

  it("shows a Rename button for each document", () => {
    renderWithStorage([
      makeDoc({ id: "a", title: "First doc", text: "a" }),
      makeDoc({ id: "b", title: "Second doc", text: "b" }),
    ]);
    expect(renameButton("First doc")).toHaveTextContent("Rename");
    expect(renameButton("Second doc")).toHaveTextContent("Rename");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("turns the title into a labelled, focused text field holding the current title", async () => {
    const { user } = renderWithStorage([makeDoc({ title: "My letter" })]);
    const field = await startRename(user, "My letter");
    expect(field).toHaveValue("My letter");
    expect(field).toHaveFocus();
    expect(field).toHaveAccessibleName(expect.stringMatching(/\S/));
    expect(field).toHaveAccessibleName(expect.stringMatching(/title|rename/i));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("saves the new title on Enter", async () => {
    const { user, storage, onRename } = renderWithStorage([makeDoc({ id: "doc-1", title: "My letter" })]);
    const field = await startRename(user, "My letter");
    await user.clear(field);
    await user.type(field, "Letter to Anna{Enter}");
    expect(getDocument("doc-1", storage)?.title).toBe("Letter to Anna");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: "doc-1", title: "Letter to Anna" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Letter to Anna/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^My letter/ })).not.toBeInTheDocument();
  });

  it("trims the new title before saving", async () => {
    const { user, storage } = renderWithStorage([makeDoc({ id: "doc-1", title: "My letter" })]);
    const field = await startRename(user, "My letter");
    await user.clear(field);
    await user.type(field, "   Trimmed title   {Enter}");
    expect(getDocument("doc-1", storage)?.title).toBe("Trimmed title");
  });

  it("saves the new title on blur", async () => {
    const { user, storage, onRename } = renderWithStorage([makeDoc({ id: "doc-1", title: "My letter" })]);
    const field = await startRename(user, "My letter");
    await user.clear(field);
    await user.type(field, "Blurred title");
    await user.click(screen.getByRole("heading", { name: "Recent documents" }));
    expect(getDocument("doc-1", storage)?.title).toBe("Blurred title");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Blurred title/ })).toBeInTheDocument();
  });

  it("saves only once when Enter is followed by a blur", async () => {
    const { user, onRename } = renderWithStorage([makeDoc({ id: "doc-1", title: "My letter" })]);
    const field = await startRename(user, "My letter");
    await user.clear(field);
    await user.type(field, "Once{Enter}");
    await user.click(screen.getByRole("heading", { name: "Recent documents" }));
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels and keeps the old title, even after the field loses focus", async () => {
    const { user, storage, onRename } = renderWithStorage([makeDoc({ id: "doc-1", title: "My letter" })]);
    const before = storage.getItem(DOCUMENTS_STORAGE_KEY);
    const field = await startRename(user, "My letter");
    await user.clear(field);
    await user.type(field, "Not this{Escape}");
    await user.click(screen.getByRole("heading", { name: "Recent documents" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(getDocument("doc-1", storage)?.title).toBe("My letter");
    expect(storage.getItem(DOCUMENTS_STORAGE_KEY)).toBe(before);
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^My letter/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Not this/ })).not.toBeInTheDocument();
  });

  it("starts from the current title again after a cancelled rename", async () => {
    const { user } = renderWithStorage([makeDoc({ title: "My letter" })]);
    let field = await startRename(user, "My letter");
    await user.type(field, " draft{Escape}");
    field = await startRename(user, "My letter");
    expect(field).toHaveValue("My letter");
  });

  it("does not save an empty title", async () => {
    const { user, storage, onRename } = renderWithStorage([makeDoc({ id: "doc-1", title: "My letter" })]);
    const before = storage.getItem(DOCUMENTS_STORAGE_KEY);
    const field = await startRename(user, "My letter");
    await user.clear(field);
    await user.keyboard("{Enter}");
    expect(getDocument("doc-1", storage)?.title).toBe("My letter");
    expect(storage.getItem(DOCUMENTS_STORAGE_KEY)).toBe(before);
    expect(onRename).not.toHaveBeenCalled();
    // Whether the field stays open or closes, leaving it must show the old title.
    if (screen.queryByRole("textbox")) await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /^My letter/ })).toBeInTheDocument();
  });

  it("does not save a whitespace-only title on blur", async () => {
    const { user, storage, onRename } = renderWithStorage([makeDoc({ id: "doc-1", title: "My letter" })]);
    const field = await startRename(user, "My letter");
    await user.clear(field);
    await user.type(field, "    ");
    await user.click(screen.getByRole("heading", { name: "Recent documents" }));
    expect(getDocument("doc-1", storage)?.title).toBe("My letter");
    expect(onRename).not.toHaveBeenCalled();
  });

  it("never saves a title longer than TITLE_MAX_LENGTH (plus an ellipsis)", async () => {
    const { user, storage } = renderWithStorage([makeDoc({ id: "doc-1", title: "My letter" })]);
    const field = await startRename(user, "My letter");
    await user.clear(field);
    await user.type(field, `${"x".repeat(TITLE_MAX_LENGTH + 10)}{Enter}`);
    const title = getDocument("doc-1", storage)?.title ?? "";
    expect(title.startsWith("x".repeat(TITLE_MAX_LENGTH))).toBe(true);
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH + 1);
  });

  it("renames only the chosen document and does not open it", async () => {
    const { user, storage, onOpen } = renderWithStorage([
      makeDoc({ id: "a", title: "First doc", text: "a", updatedAt: 2 }),
      makeDoc({ id: "b", title: "Second doc", text: "b", updatedAt: 1 }),
    ]);
    const field = await startRename(user, "Second doc");
    await user.clear(field);
    await user.type(field, "Renamed second{Enter}");
    expect(getDocument("a", storage)?.title).toBe("First doc");
    expect(getDocument("b", storage)?.title).toBe("Renamed second");
    expect(onOpen).not.toHaveBeenCalled();
  });
});
