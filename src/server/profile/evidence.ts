import { z } from "zod";
import { EnrichmentEvidence, SavedEnrichmentSource } from "@/contracts/enrichment";
import { EvidenceDoc } from "@/contracts/types";
import { MAX_REPO_EVIDENCE } from "./index";

export type ApprovedEvidence = z.infer<typeof EnrichmentEvidence>;
export const ProfileSource = SavedEnrichmentSource.extend({ removed: z.boolean().optional() });
export type ProfileSource = z.infer<typeof ProfileSource>;
type Stored = { id: string; githubLogin: string | null; createdAt: Date; githubEvidence: unknown; profileEvidence?: unknown; profileSources?: unknown };
function invalid(): never { throw Object.assign(new Error("Stored profile evidence is invalid."), { status: 503 }); }

/** Validate before indexing; an approved empty array must never restore legacy evidence. */
export function approvedSnapshot(user: Stored): ApprovedEvidence[] {
  let input = user.profileEvidence;
  if (input === null || input === undefined) {
    const legacy = EvidenceDoc.array().max(MAX_REPO_EVIDENCE).safeParse(user.githubEvidence);
    if (!legacy.success || legacy.data.some(e => e.personId !== user.id || e.kind !== "repo")) invalid();
    input = legacy.data.map(({ text, ...e }) => ({ ...e, sourceId: `${user.id}:github`, source: "github", excerpt: text, retrievedAt: user.createdAt.toISOString() }));
  }
  const parsed = EnrichmentEvidence.array().max(36).safeParse(input);
  if (!parsed.success) invalid();
  const docs = parsed.data;
  if (new Set(docs.map(e => e.id)).size !== docs.length || docs.some(e => e.personId !== user.id || !e.id.startsWith(`${user.id}:${e.kind}:`)
    || e.sourceId !== `${user.id}:${e.source}`
    || (e.source === "github" && (!["repo", "profile_page"].includes(e.kind) || (e.kind === "profile_page" && !e.url)))
    || (e.source === "research" && (e.kind !== "paper" || !e.url))
    || (e.source === "cv" && (e.kind !== "cv" || e.url !== undefined))
    || (e.source === "public_profile" && e.kind !== "profile_page"))) invalid();
  for (const [source, maximum] of [["github", 20], ["research", 10], ["public_profile", 1], ["cv", 5]] as const)
    if (docs.filter(e => e.source === source).length > maximum) invalid();
  return docs;
}

export function indexedEvidence(user: Stored): EvidenceDoc[] {
  return approvedSnapshot(user).map(({ id, personId, kind, title, excerpt: text, url }) => ({ id, personId, kind, title, text, ...(url ? { url } : {}) }));
}

export function sourceRecords(user: Stored): ProfileSource[] {
  const docs = approvedSnapshot(user);
  if (user.profileEvidence === null || user.profileEvidence === undefined) return docs.length ? [{
    id: `${user.id}:github`, source: "github", label: "GitHub", evidenceCount: docs.length, approvedAt: user.createdAt.toISOString(),
    ...(user.githubLogin ? { url: `https://github.com/${user.githubLogin}` } : {}),
  }] : [];
  const parsed = ProfileSource.array().max(4).safeParse(user.profileSources === undefined ? [] : user.profileSources);
  if (!parsed.success || new Set(parsed.data.map(s => s.source)).size !== parsed.data.length
    || parsed.data.some(s => s.id !== `${user.id}:${s.source}` || s.evidenceCount !== docs.filter(e => e.sourceId === s.id).length
      || (s.removed && s.evidenceCount !== 0))
    || docs.some(e => !parsed.data.some(s => s.id === e.sourceId && !s.removed))) invalid();
  return parsed.data;
}
