"use client";

import { type Ref, useState, useRef, useEffect } from "react";
import { notePreview, type DocumentSource, type SavedDocument, clearDocuments, renameDocument } from "@/lib/documents";
import { Modal } from "./Modal";

export const SOURCE_LABELS: Record<DocumentSource, string> = {
  paste: "Pasted text",
  file: "Text file",
  pdf: "PDF",
  image: "Photo or image",
  url: "Web page",
};

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return new Date(ms).toDateString();
  }
}

export interface RecentDocumentsProps {
  documents: SavedDocument[];
  onOpen: (doc: SavedDocument) => void;
  onDelete: (doc: SavedDocument) => void;
  headingRef?: Ref<HTMLHeadingElement>;
  storage?: Storage | null;
  onClearAll?: () => void;
  /** Called after a document has been renamed */
  onRename?: (doc: SavedDocument) => void;
}

export function RecentDocuments({
  documents,
  onOpen,
  onDelete,
  headingRef,
  storage,
  onClearAll,
  onRename,
}: RecentDocumentsProps) {
  const [showClearModal, setShowClearModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClearAll = () => {
    clearDocuments(storage);
    setShowClearModal(false);
    if (onClearAll) onClearAll();
  };

  const openClearModal = (event: React.MouseEvent) => {
    event.stopPropagation();
    setShowClearModal(true);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditValue("");
  };

  const handleRename = (id: string, value: string) => {
    const cleaned = typeClean(value);
    if (!cleaned) {
      cancelRename();
      return;
    }
    const updated = renameDocument(id, cleaned, storage);
    if (updated && onRename) onRename(updated);
    cancelRename();
  };

  const typeClean = (s: string) => tidyTitle(s);

  const tidyTitle = (title: string) => {
    const clean = title.replace(/\s+/g, " ").trim();
    return clean;
  };

  useEffect(() => {
    if (editingId && inputRef.current) {
      const el = inputRef.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [editingId]);

  return (
    <section aria-labelledby="recent-heading" className="space-y-4">
      <h2 id="recent-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-bold">
        Recent documents
      </h2>
      {documents.length === 0 ? (
        <p className="text-lg text-muted">
          Nothing here yet. Documents you read will appear here.
        </p>
      ) : (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openClearModal}
              className="rounded-lg border-2 border-fg px-4 py-2 text-sm font-medium hover:bg-fg hover:text-bg"
            >
              Clear all
            </button>
          </div>
          <ul className="space-y-3">
            {documents.map((doc) => {
              const preview = notePreview(doc.note);
              return (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-stretch gap-2 rounded-xl border-2 border-fg bg-surface p-2"
                >
                  {editingId === doc.id ? (
                    <input
                      ref={inputRef}
                      type="text"
                      aria-label="Title"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleRename(doc.id, editValue);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      onBlur={() => handleRename(doc.id, editValue)}
                      className="flex-1 rounded-lg px-3 py-2 text-base"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpen(doc)}
                      className="flex min-h-12 min-w-0 flex-1 flex-col items-start rounded-lg px-3 py-2 text-left text-lg"
                    >
                      <span className="font-bold break-words">{doc.title}</span> <span className="text-base text-muted">
                        {SOURCE_LABELS[doc.source]} · {formatDate(doc.updatedAt)}
                      </span>
                      {preview ? (
                        <>
                          {' '}
                          <span data-testid="note-preview" className="text-base text-fg break-words">
                            Note: {preview}
                          </span>
                        </>
                      ) : null}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Delete ${doc.title}`}
                    onClick={() => onDelete(doc)}
                    className="min-h-12 min-w-12 self-center rounded-lg border-2 border-fg px-4 text-lg"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    aria-label={`Rename ${doc.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(doc.id);
                      setEditValue(doc.title);
                    }}
                    className="min-h-12 min-w-12 self-center rounded-lg border-2 border-fg px-4 text-lg"
                  >
                    Rename
                  </button>
                </li>
              );
            })}
          </ul>
          <Modal
            open={showClearModal}
            onClose={() => setShowClearModal(false)}
            title="Clear all documents?"
            returnFocusRef={undefined}
          >
            <p className="mb-4">
              Are you sure you want to delete all your documents? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowClearModal(false)}
                className="rounded-lg border-2 border-fg px-4 py-2 font-medium hover:bg-fg hover:text-bg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="rounded-lg bg-red-500 px-4 py-2 text-white hover:bg-red-600"
              >
                Clear all
              </button>
            </div>
          </Modal>
        </>
      )}
    </section>
  );
}
