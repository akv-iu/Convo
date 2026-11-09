/**
 * What the Elasticsearch and in-memory search share, so both behave the same: the evidence
 * list behind a match (each person's distinct evidence in search order, at most five, with
 * only https links kept), the checks on evidence they're given, and approved expertise.
 */
import { EvidenceKind, type EvidenceDoc, type MatchEvidence, type Person } from "@/contracts/types";

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

/** The ID of the document search generates from a person's profile. No evidence may take it. */
export const profileDocId = (personId: string) => `${personId}:profile`;

/**
 * Refuse evidence that could overwrite another document: each item must be this person's and must
 * not take the generated profile's ID. A real save (one with a revision) also names every ID
 * "<personId>:<kind>:<source ID>", so two people's copies of one paper stay apart; fixtures and
 * synthetic people predate that.
 */
export function checkEvidence(personId: string, docs: readonly EvidenceDoc[], realSave: boolean): void {
  for (const doc of docs) {
    const namespace = `${personId}:${doc.kind}:`;
    if (doc.personId !== personId) throw new Error(`Evidence ${doc.id} belongs to ${doc.personId}, not ${personId}.`);
    if (doc.id === profileDocId(personId)) throw new Error(`Evidence ${doc.id} takes the generated profile's ID.`);
    if (realSave && (!doc.id.startsWith(namespace) || doc.id.length === namespace.length)) {
      throw new Error(`Evidence ${doc.id} needs an ID of the form ${namespace}<source ID>.`);
    }
  }
}

/** Approved expertise labels. Typed loosely until the enrichment contract adds Person.expertise to main. */
export function expertiseOf(person: Person): readonly string[] {
  return (person as Person & { expertise?: readonly string[] }).expertise ?? [];
}
