"use client";

import { type Ref, useState, useRef } from "react";
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
  onRename?: (doc: SavedDocument) => void;
  headingRef?: Ref<HTMLHeadingElement>;
  storage?: Storage | null;
  onClearAll?: () => void;
}

export function RecentDocuments({ documents, onOpen, onDelete, headingRef, storage, onClearAll }: RecentDocumentsProps) {
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [editingValue, setEditingValue] = useState<string>("");
  const ignoreBlurRef = useRef(false);

  function handleSaveRename(docId: string | null, title: string | undefined) {
    const updated = docId && title ? renameDocument(docId, title, storage) : null;
    if (updated && onRename) onRename(updated);
    setEditingDocId(null);
  }

  const handleClearAll = () => {
    clearDocuments(storage);
    setShowClearModal(false);
    // Call parent callback to update documents list
    if (onClearAll) {
      onClearAll();
    }
  };

  const openClearModal = (event: React.MouseEvent) => {
    event.stopPropagation();
    setShowClearModal(true);
  };

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
                  <button
                    type="button"
                    onClick={() => onOpen(doc)}
                    className="flex min-h-12 min-w-0 flex-1 flex-col items-start rounded-lg px-3 py-2 text-left text-lg"
                  >
                    <span className="font-bold break-words">{doc.title}</span> {" "}
                    <span className="text-base text-muted">
                      {SOURCE_LABELS[doc.source]} · {formatDate(doc.updatedAt)}
                    </span>
                    {preview ? (
                      <>
                        " "
                        <span data-testid="note-preview" className="text-base text-fg break-words">
                          Note: {preview}
                        </span>
                      </>
                    ) : null}
                  </button>
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
                    onClick={() => { setEditingDocId(doc.id); setEditingValue(doc.title); }}
                    className="min-h-12 min-w-12 self-center rounded-lg border-2 border-fg px-4 text-lg"
                  >
                    Rename
                  </button>
                  {editingDocId === doc.id && (
                    <input
                      type="text"
                      role="textbox"
                      aria-label="Title"
                      autoFocus
                      value={editingValue}
                      onChange={e => setEditingValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          ignoreBlurRef.current = true;
                          handleSaveRename(doc.id, editingValue);
                        } else if (e.key === 'Escape') {
                          ignoreBlurRef.current = true;
                          setEditingDocId(null);
                        }
                      }}
                      onBlur={() => {
                        if (ignoreBlurRef.current) {
                          ignoreBlurRef.current = false;
                          return;
                        }
                        handleSaveRename(doc.id, editingValue);
                      }}
                      className="mt-2 flex-1 rounded-lg border border-fg px-3 py-1 text-base"
                    />
                  )}
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
