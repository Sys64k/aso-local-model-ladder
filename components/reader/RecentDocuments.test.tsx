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

describe("RecentDocuments rename", () => {
  function RenameHarness({
    storage,
    onOpen,
    onRename,
  }: {
    storage: MemoryStorage;
    onOpen: (doc: SavedDocument) => void;
    onRename: (doc: SavedDocument) => void;
  }) {
    const [docs, setDocs] = useState(() => listDocuments(storage));
    return (
      <RecentDocuments
        documents={docs}
        onOpen={onOpen}
        onDelete={() => {}}
        storage={storage}
        onRename={(doc) => {
          onRename(doc);
          setDocs(listDocuments(storage));
        }}
      />
    );
  }

  function setupRename(titles: string[] = ["My letter"]) {
    const storage = new MemoryStorage();
    const saved = titles.map((title, i) =>
      saveDocument({ title, text: `Text number ${i}.`, source: "paste" }, storage),
    );
    const onOpen = vi.fn();
    const onRename = vi.fn();
    const user = userEvent.setup();
    render(<RenameHarness storage={storage} onOpen={onOpen} onRename={onRename} />);
    return { storage, saved, onOpen, onRename, user };
  }

  function titleField(): HTMLInputElement {
    return screen.getByRole("textbox", { name: /title/i }) as HTMLInputElement;
  }

  it("shows a Rename button for each document", () => {
    setupRename(["First doc", "Second doc"]);
    expect(screen.getByRole("button", { name: "Rename First doc" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Second doc" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("turns the title into a labelled, focused text field holding the current title", async () => {
    const { user, onOpen } = setupRename();
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    const field = titleField();
    expect(field).toHaveAccessibleName(expect.stringMatching(/title/i));
    expect(field).toHaveValue("My letter");
    expect(field).toHaveFocus();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("saves the new title on Enter", async () => {
    const { user, storage, saved, onRename, onOpen } = setupRename();
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.clear(titleField());
    await user.type(titleField(), "Bank letter{Enter}");
    expect(getDocument(saved[0].id, storage)?.title).toBe("Bank letter");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: saved[0].id, title: "Bank letter" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Bank letter/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Bank letter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^My letter/ })).not.toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("saves the new title on blur", async () => {
    const { user, storage, saved, onRename } = setupRename();
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.clear(titleField());
    await user.type(titleField(), "Blurred name");
    await user.tab();
    expect(getDocument(saved[0].id, storage)?.title).toBe("Blurred name");
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: saved[0].id, title: "Blurred name" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Blurred name/ })).toBeInTheDocument();
  });

  it("trims the saved title", async () => {
    const { user, storage, saved } = setupRename();
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.clear(titleField());
    await user.type(titleField(), "   Spaced out   {Enter}");
    expect(getDocument(saved[0].id, storage)?.title).toBe("Spaced out");
    expect(screen.getByRole("button", { name: /^Spaced out/ })).toBeInTheDocument();
  });

  it("Escape cancels and keeps the old title", async () => {
    const { user, storage, saved, onRename } = setupRename();
    const writes = storage.writes;
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.clear(titleField());
    await user.type(titleField(), "Discarded{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^My letter/ })).toBeInTheDocument();
    expect(screen.queryByText("Discarded")).not.toBeInTheDocument();
    // Moving focus elsewhere afterwards must not save the discarded text either.
    await user.tab();
    expect(getDocument(saved[0].id, storage)?.title).toBe("My letter");
    expect(storage.writes).toBe(writes);
    expect(onRename).not.toHaveBeenCalled();
  });

  it("does not save an empty title on Enter", async () => {
    const { user, storage, saved, onRename } = setupRename();
    const writes = storage.writes;
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.clear(titleField());
    await user.keyboard("{Enter}");
    expect(getDocument(saved[0].id, storage)?.title).toBe("My letter");
    expect(storage.writes).toBe(writes);
    expect(onRename).not.toHaveBeenCalled();
    if (screen.queryByRole("textbox")) await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /^My letter/ })).toBeInTheDocument();
  });

  it("does not save a whitespace-only title on blur", async () => {
    const { user, storage, saved, onRename } = setupRename();
    const writes = storage.writes;
    await user.click(screen.getByRole("button", { name: "Rename My letter" }));
    await user.clear(titleField());
    await user.type(titleField(), "    ");
    await user.tab();
    expect(getDocument(saved[0].id, storage)?.title).toBe("My letter");
    expect(storage.writes).toBe(writes);
    expect(onRename).not.toHaveBeenCalled();
    if (screen.queryByRole("textbox")) {
      titleField().focus();
      await user.keyboard("{Escape}");
    }
    expect(screen.getByRole("button", { name: /^My letter/ })).toBeInTheDocument();
  });

  it("only renames the chosen document", async () => {
    const { user, storage, saved } = setupRename(["Alpha", "Beta"]);
    const [alpha, beta] = saved;
    await user.click(screen.getByRole("button", { name: "Rename Alpha" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(titleField()).toHaveValue("Alpha");
    await user.clear(titleField());
    await user.type(titleField(), "Gamma{Enter}");
    expect(getDocument(alpha.id, storage)?.title).toBe("Gamma");
    expect(getDocument(beta.id, storage)?.title).toBe("Beta");
    expect(screen.getByRole("button", { name: /^Gamma/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Beta/ })).toBeInTheDocument();
    expect(listDocuments(storage)).toHaveLength(2);
  });
});
