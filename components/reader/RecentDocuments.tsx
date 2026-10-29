"use client";

import { type Ref, useState, useRef } from "react";
import { notePreview, type DocumentSource, type SavedDocument, renameDocument, clearDocuments } from "@/lib/documents";
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
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const preventBlurRef = useRef(false);
  const [showClearModal, setShowClearModal] = useState(false);

  function commitSave() {
    if (!editId) return;
    const newTitle = editTitle.trim();
    if (!newTitle) {
      cancelEdit();
      return;
    }
    const updated = renameDocument(editId, newTitle, storage);
    if (updated) {
      onRename?.(updated);
    }
    cancelEdit();
  }

  function cancelEdit() {
    setEditId(null);
    setEditTitle('');
    preventBlurRef.current = false;
  }

  function handleClearAll() {
    clearDocuments(storage);
    setShowClearModal(false);
    if (onClearAll) {
      onClearAll();
    }
  }

  function openClearModal(event: React.MouseEvent) {
    event.stopPropagation();
    setShowClearModal(true);
  }

  return (
    <section aria-labelledby="recent-heading" className="space-y-4">
      <h2 id="recent-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-bold">
        Recent documents
      </h2>
      {documents.length === 0 ? (
        <p className="text-lg text-muted">Nothing here yet. Documents you read will appear here.</p>
      ) : (
        <>
          <div className="flex justify-end">
            <button type="button" onClick={openClearModal} className="rounded-lg border-2 border-fg px-4 py-2 text-sm font-medium hover:bg-fg hover:text-bg">
              Clear all
            </button>
          </div>
          <ul className="space-y-3">
            {documents.map((doc) => {
              const preview = notePreview(doc.note);
              return (
                <li key={doc.id} className="flex flex-wrap items-stretch gap-2 rounded-xl border-2 border-fg bg-surface p-2">
                  {editId === doc.id ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitSave();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      onBlur={() => { if (!preventBlurRef.current) commitSave(); }}
                      aria-label={`Title for ${doc.title}`}
                      autoFocus
                      className="flex flex-1 min-h-12 min-w-0 rounded-lg px-3 py-2 text-left text-lg"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpen(doc)}
                      className="flex min-h-12 min-w-0 flex-1 flex-col items-start rounded-lg px-3 py-2 text-left text-lg"
                    >
                      <span className="font-bold break-words">{doc.title}</span> <span className="text-base text-muted">{SOURCE_LABELS[doc.source]} · {formatDate(doc.updatedAt)}</span>{preview ? (<><span className="text-base text-fg break-words"> Note: {preview}</span></>) : null}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Rename ${doc.title}`}
                    onClick={() => {
                      setEditId(doc.id);
                      setEditTitle(doc.title);
                    }}
                    className="min-h-12 min-w-12 self-center rounded-lg border-2 border-fg px-4 text-lg"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${doc.title}`}
                    onClick={() => onDelete(doc)}
                    className="min-h-12 min-w-12 self-center rounded-lg border-2 border-fg px-4 text-lg"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
          <Modal open={showClearModal} onClose={() => setShowClearModal(false)} title="Clear all documents?" returnFocusRef={undefined}>
            <p className="mb-4">Are you sure you want to delete all your documents? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowClearModal(false)} className="rounded-lg border-2 border-fg px-4 py-2 font-medium hover:bg-fg hover:text-bg">Cancel</button>
              <button type="button" onClick={handleClearAll} className="rounded-lg bg-red-500 px-4 py-2 text-white hover:bg-red-600">Clear all</button>
            </div>
          </Modal>
        </>
      )}
    </section>
  );
}
