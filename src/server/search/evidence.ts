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

/**
 * Words that say what kind of ask it is, not what it's about. Matching on them ranked anyone who
 * mentions "roles", "hiring" or "work" (measured 2026-11-09: a healthcare-employer ask showed ten
 * people with no healthcare evidence). Search on the remaining words; the semantic half still reads
 * the whole question.
 */
const FILLER = new Set(`a about after also an and any anyone are as at be before best but by can could did difference do does
for from get good had has have help here how i if in into is it its join joined joining just kind know knows learn like look
looking lot made make me meet more most much my need needs not of on or our out people person potential practices question
questions really role roles sort someone something specifically stand start started tell that the there these they this
those tips to together type understand up very want wants was we what when where which who why will with would you your
work works working job jobs career careers hire hires hiring hired employer employers company companies position positions
opportunity opportunities experience experiences advice explain application team teams open
own path first should industry`.split(/\s+/));

/** The words of an ask that say what it's about, for keyword search. Falls back to the whole ask. */
export function keyTerms(text: string): string {
  const words = text.split(/[^\p{L}\p{N}+#.-]+/u).map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w.length > 1 && !FILLER.has(w.toLowerCase()));
  return words.length ? words.join(" ") : text;
}

/** The workplace search may read: only when the person shows it on their badge. */
export const shownWorkplace = (person: Person): string =>
  person.visibility?.workplace === false ? "" : person.workplaceName?.trim() ?? "";
