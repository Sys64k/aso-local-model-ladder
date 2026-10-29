
// --- renameDocument implementation
// Add before notePreview
export function renameDocument(
  id: string,
  title: string,
  storage?: Storage | null,
): SavedDocument | null {
  const store = resolve(storage);
  const docs = listDocuments(store);
  const doc = docs.find((d) => d.id === id);
  if (!doc) return null;
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  let newTitle: string;
  if (clean.length > TITLE_MAX_LENGTH) {
    const slice = clean.slice(0, TITLE_MAX_LENGTH + 1);
    const lastSpace = slice.lastIndexOf(" ");
    const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : clean.slice(0, TITLE_MAX_LENGTH);
    newTitle = `${cut.replace(/[\s,;:.\-–—]+$/, "")}`;
    if (clean.length > TITLE_MAX_LENGTH) newTitle += "…";
  } else {
    newTitle = clean;
  }

  const updated: SavedDocument = { ...doc, title: newTitle, updatedAt: Date.now() };
  write(
    store,
    sortNewestFirst([updated, ...docs.filter((d) => d.id !== id)]),
  );
  return updated;
}
