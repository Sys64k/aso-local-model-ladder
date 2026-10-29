import { listDocuments, SavedDocument } from './documents';

/**
 * Return the list of documents matching the query.
 *
 * Matching is case-insensitive and considers the document title, text, and note.
 * Title matches are returned before text/note matches; within each group the
 * documents are sorted from newest to oldest based on updatedAt.
 * An empty or whitespace query returns all documents.
 */
export function searchDocuments(query: string, storage?: Storage | null): SavedDocument[] {
  const docs = listDocuments(storage);
  const trimmed = query.trim();
  if (!trimmed) return docs;
  const q = trimmed.toLowerCase();
  const titleMatches: SavedDocument[] = [];
  const otherMatches: SavedDocument[] = [];
  for (const d of docs) {
    const titleLower = d.title.toLowerCase();
    if (titleLower.includes(q)) {
      titleMatches.push(d);
    } else if (d.text.toLowerCase().includes(q) || d.note.toLowerCase().includes(q)) {
      otherMatches.push(d);
    }
  }
  return [...titleMatches, ...otherMatches];
}
