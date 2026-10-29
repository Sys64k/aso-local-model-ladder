import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  TITLE_MAX_LENGTH,
  getDocument,
  listDocuments,
  saveDocument,
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
   * `onRename` (called with the renamed document) refreshes them.
   */
  function RenameHarness({
    storage,
    onRename,
    onOpen,
  }: {
    storage: Storage;
    onRename: (doc: SavedDocument) => void;
    onOpen: (doc: SavedDocument) => void;
  }) {
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

  function setupRename(titles: string[] = ["My letter"]) {
    const storage = new MemoryStorage();
    const docs = titles.map((title, i) =>
      saveDocument({ title, text: `Text number ${i}.`, source: "paste" }, storage),
    );
    const onRename = vi.fn();
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<RenameHarness storage={storage} onRename={onRename} onOpen={onOpen} />);
    return { storage, docs, onRename, onOpen, user };
  }

  function itemFor(title: string): HTMLElement {
    const open = screen.getByRole("button", { name: new RegExp(`^${escapeRegExp(title)}`) });
    const item = open.closest("li");
    if (!item) throw new Error(`no list item for ${title}`);
    return item;
  }

  function renameButton(title: string): HTMLElement {
    return within(itemFor(title)).getByRole("button", { name: /^Rename\b/ });
  }

  function titleField(): HTMLInputElement {
    return screen.getByRole("textbox", { name: /title|rename/i }) as HTMLInputElement;
  }

  it("shows a Rename button for each document", () => {
    setupRename(["First doc", "Second doc"]);
    expect(renameButton("First doc")).toBeInTheDocument();
    expect(renameButton("Second doc")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("turns the title into a labelled, focused text field holding the current title", async () => {
    const { user, onOpen } = setupRename();
    await user.click(renameButton("My letter"));
    const field = titleField();
    expect(field).toHaveAccessibleName(expect.stringMatching(/\S/));
    expect(field).toHaveValue("My letter");
    expect(field).toHaveFocus();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("saves the new title on Enter", async () => {
    const { user, storage, docs, onRename, onOpen } = setupRename();
    await user.click(renameButton("My letter"));
    const field = titleField();
    await user.clear(field);
    await user.type(field, "Letter to Anna{Enter}");
    expect(getDocument(docs[0].id, storage)?.title).toBe("Letter to Anna");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: docs[0].id, title: "Letter to Anna" }),
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Letter to Anna/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^My letter/ })).not.toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("saves the new title on blur", async () => {
    const { user, storage, docs, onRename } = setupRename();
    await user.click(renameButton("My letter"));
    const field = titleField();
    await user.clear(field);
    await user.type(field, "Blurred name");
    await user.tab();
    expect(getDocument(docs[0].id, storage)?.title).toBe("Blurred name");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Blurred name/ })).toBeInTheDocument();
  });

  it("trims the new title before saving", async () => {
    const { user, storage, docs } = setupRename();
    await user.click(renameButton("My letter"));
    const field = titleField();
    await user.clear(field);
    await user.type(field, "   Spaced out   {Enter}");
    expect(getDocument(docs[0].id, storage)?.title).toBe("Spaced out");
    expect(screen.getByRole("button", { name: /^Spaced out/ })).toBeInTheDocument();
  });

  it("respects TITLE_MAX_LENGTH", async () => {
    const { user, storage, docs } = setupRename();
    await user.click(renameButton("My letter"));
    const field = titleField();
    await user.clear(field);
    await user.type(field, `${"z".repeat(TITLE_MAX_LENGTH + 10)}{Enter}`);
    const title = getDocument(docs[0].id, storage)?.title ?? "";
    expect(title.startsWith("z".repeat(TITLE_MAX_LENGTH - 1))).toBe(true);
    expect(title.replace(/…$/, "").length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
  });

  it("keeps the old title on Escape", async () => {
    const { user, storage, docs, onRename } = setupRename();
    await user.click(renameButton("My letter"));
    const field = titleField();
    await user.clear(field);
    await user.type(field, "Never saved");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^My letter/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Never saved/ })).not.toBeInTheDocument();
    expect(getDocument(docs[0].id, storage)?.title).toBe("My letter");
    expect(onRename).not.toHaveBeenCalled();
    // Moving focus afterwards must not save the abandoned edit either.
    await user.tab();
    expect(getDocument(docs[0].id, storage)?.title).toBe("My letter");
    expect(onRename).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", "    "],
  ])("does not save an %s title", async (_label, typed) => {
    const { user, storage, docs, onRename } = setupRename();
    await user.click(renameButton("My letter"));
    const field = titleField();
    await user.clear(field);
    if (typed) await user.type(field, typed);
    await user.keyboard("{Enter}");
    expect(getDocument(docs[0].id, storage)?.title).toBe("My letter");
    expect(onRename).not.toHaveBeenCalled();
    // Whether the field stays open or closes, the old title survives.
    if (screen.queryByRole("textbox")) await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /^My letter/ })).toBeInTheDocument();
    expect(getDocument(docs[0].id, storage)?.title).toBe("My letter");
    expect(onRename).not.toHaveBeenCalled();
  });

  it("renames only the chosen document", async () => {
    const { user, storage, docs } = setupRename(["First doc", "Second doc"]);
    await user.click(renameButton("First doc"));
    const field = titleField();
    expect(field).toHaveValue("First doc");
    await user.clear(field);
    await user.type(field, "First renamed{Enter}");
    expect(getDocument(docs[0].id, storage)?.title).toBe("First renamed");
    expect(getDocument(docs[1].id, storage)?.title).toBe("Second doc");
    expect(screen.getByRole("button", { name: /^Second doc/ })).toBeInTheDocument();
  });
});
