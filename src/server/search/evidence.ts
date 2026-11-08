/**
 * The evidence list behind a match (shown on the open profile): each person's distinct
 * evidence in search order, at most five, with only https links kept. Shared by the
 * Elasticsearch and in-memory search so both build it the same way.
 */
import { EvidenceKind, type MatchEvidence } from "@/contracts/types";

export const MAX_EVIDENCE = 5;

/**
 * The link, normalised (so "HTTPS://…" becomes "https://…"), if it's a well-formed https URL;
 * anything else (http, javascript:, garbage) is dropped.
 */
export function httpsLink(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Add a document to a person's evidence list if there's room, it's a kind of evidence (not
 * the generated profile document) and it isn't already listed.
 */
export function addEvidence(list: MatchEvidence[], doc: { kind: string; title: string; url?: string }): void {
  if (list.length >= MAX_EVIDENCE) return;
  const kind = EvidenceKind.safeParse(doc.kind);
  if (!kind.success) return;
  const url = httpsLink(doc.url);
  if (list.some((e) => e.kind === kind.data && e.title === doc.title && e.url === url)) return;
  list.push(url ? { kind: kind.data, title: doc.title, url } : { kind: kind.data, title: doc.title });
}
