import type { DocumentSource } from "@/lib/documents";

export interface ImportedText {
  title: string;
  text: string;
  source: DocumentSource;
}
