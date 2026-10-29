import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { getDocument, listDocuments, saveDocument, type SavedDocument } from "@/lib/documents";
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

/**
 * Renders the list the way ReaderApp does: documents come from storage and
 * onRename re-reads them, so a saved rename shows up in the list.
 */
function renderStored(titles: string[]) {
  const storage = new MemoryStorage();
  const docs = titles.map((title, i) =>
    saveDocument({ title, text: `Text number ${i}.`, source: "paste" }, storage),
  );
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  const onRename = vi.fn();
  function Harness() {
    const [documents, setDocuments] = useState(() => listDocuments(storage));
    return (
      <>
        <RecentDocuments
          documents={documents}
          onOpen={onOpen}
          onDelete={onDelete}
          storage={storage}
          onRename={(doc) => {
            onRename(doc);
            setDocuments(listDocuments(storage));
          }}
        />
        <button type="button">Elsewhere</button>
      </>
    );
  }
  render(<Harness />);
  return { storage, docs, onOpen, onDelete, onRename, user: userEvent.setup() };
}

function titleField(): HTMLInputElement {
  return screen.getByRole("textbox", { name: /title/i }) as HTMLInputElement;
}

describe("RecentDocuments rename", () => {
  it("shows a Rename button for each document, named after it", () => {
    renderStored(["First doc", "Second doc"]);
    expect(screen.getByRole("button", { name: "Rename First doc" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Second doc" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename First doc" })).toHaveTextContent("Rename");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("turns the title into a labelled, focused text field holding the current title", async () => {
    const { user } = renderStored(["My letter"]);
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    const field = titleField();
    expect(field).toHaveValue("My letter");
    expect(field).toHaveFocus();
    expect(field).toHaveAccessibleName(expect.stringMatching(/title/i));
    expect(field.tagName).toBe("INPUT");
  });

  it("Enter saves the new title", async () => {
    const { user, storage, docs, onRename, onOpen } = renderStored(["My letter"]);
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.clear(titleField());
    await user.type(titleField(), "Letter to Anna{Enter}");
    expect(getDocument(docs[0].id, storage)?.title).toBe("Letter to Anna");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: docs[0].id, title: "Letter to Anna" }),
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Letter to Anna/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Letter to Anna" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^My letter/ })).not.toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("blur saves the new title", async () => {
    const { user, storage, docs, onRename } = renderStored(["My letter"]);
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.clear(titleField());
    await user.type(titleField(), "Blurred name");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(getDocument(docs[0].id, storage)?.title).toBe("Blurred name");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Blurred name/ })).toBeInTheDocument();
  });

  it("trims the saved title", async () => {
    const { user, storage, docs } = renderStored(["My letter"]);
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.clear(titleField());
    await user.type(titleField(), "   Padded   {Enter}");
    expect(getDocument(docs[0].id, storage)?.title).toBe("Padded");
    expect(screen.getByRole("button", { name: "Rename Padded" })).toBeInTheDocument();
  });

  it("Escape keeps the old title and saves nothing", async () => {
    const { user, storage, docs, onRename } = renderStored(["My letter"]);
    const writes = storage.writes;
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.clear(titleField());
    await user.type(titleField(), "Discarded{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // Moving focus elsewhere afterwards must not save the discarded text either.
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(onRename).not.toHaveBeenCalled();
    expect(storage.writes).toBe(writes);
    expect(getDocument(docs[0].id, storage)?.title).toBe("My letter");
    expect(screen.getByRole("button", { name: /^My letter/ })).toBeInTheDocument();
    expect(screen.queryByText("Discarded")).not.toBeInTheDocument();
  });

  it("starts from the current title again after cancelling", async () => {
    const { user } = renderStored(["My letter"]);
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.type(titleField(), " draft{Escape}");
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    expect(titleField()).toHaveValue("My letter");
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", "    "],
  ])("does not save an %s title (Enter or blur)", async (_label, typed) => {
    const { user, storage, docs, onRename } = renderStored(["My letter"]);
    const writes = storage.writes;
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.clear(titleField());
    if (typed) await user.type(titleField(), typed);
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    // The field may stay open or close; either way nothing is saved.
    if (screen.queryByRole("textbox")) {
      titleField().focus();
      await user.keyboard("{Escape}");
    }
    expect(onRename).not.toHaveBeenCalled();
    expect(storage.writes).toBe(writes);
    expect(getDocument(docs[0].id, storage)?.title).toBe("My letter");
    expect(screen.getByRole("button", { name: /^My letter/ })).toBeInTheDocument();
  });

  it("only renames the chosen document", async () => {
    const { user, storage, docs } = renderStored(["First doc", "Second doc"]);
    await user.click(screen.getByRole("button", { name: "Rename First doc" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(titleField()).toHaveValue("First doc");
    await user.clear(titleField());
    await user.type(titleField(), "Renamed first{Enter}");
    expect(getDocument(docs[0].id, storage)?.title).toBe("Renamed first");
    expect(getDocument(docs[1].id, storage)?.title).toBe("Second doc");
    expect(screen.getByRole("button", { name: /^Second doc/ })).toBeInTheDocument();
  });

  it("does not open the document while editing", async () => {
    const { user, onOpen, onDelete } = renderStored(["My letter"]);
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.click(titleField());
    await user.type(titleField(), "{Escape}");
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.type(titleField(), " again{Enter}");
    expect(onOpen).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("limits a long title to TITLE_MAX_LENGTH", async () => {
    const { user, storage, docs } = renderStored(["My letter"]);
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.clear(titleField());
    await user.type(titleField(), `${"a".repeat(80)}{Enter}`);
    const saved = getDocument(docs[0].id, storage)?.title ?? "";
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.replace(/…$/, "").length).toBeLessThanOrEqual(60);
    expect(saved.length).toBeLessThanOrEqual(61);
  });
});
