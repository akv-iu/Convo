/**
 * Page five with profile enrichment on: what to show for the import job, what the
 * approval sends, and the warnings shown before approving. Nothing generated is
 * published until the person approves it (POST /api/profile-enrichment/:id/accept).
 */
import type { AcceptEnrichment, EnrichmentErrorCode, EnrichmentJob } from "@/contracts/enrichment";
import { countryName } from "@/components/ui/countries";
import type { Person } from "@/contracts/types";
import { SHOW_ALL } from "../answers";
import type { z } from "zod";

type Draft = NonNullable<EnrichmentJob["draft"]>;
type Evidence = Draft["evidence"][number];

export const BIO_MAX = 600;
export const EXPERTISE = { chip: 60, chips: 8 } as const;

/**
 * none: nothing to review (no import, manual, cancelled or replaced), so the usual details page.
 * done: already approved. working: still reading. trouble: stuck or failed, with retry.
 */
export type ReviewView = "none" | "done" | "working" | "trouble" | "review";

export function reviewView(job: Pick<EnrichmentJob, "state" | "draft"> | null): ReviewView {
  if (!job || ["manual", "cancelled", "superseded"].includes(job.state)) return "none";
  if (job.state === "accepted") return "done";
  if (job.state === "queued" || job.state === "running") return "working";
  if ((job.state === "ready" || job.state === "partial") && job.draft) return "review";
  return "trouble";
}

/** Everything starts selected except CV excerpts, which the person opts into one by one. */
export function initialPicks(draft: Draft): string[] {
  return draft.evidence.filter((e) => e.source !== "cv").map((e) => e.id);
}

export interface ReviewEdits {
  bio: string;
  expertise: string[];
  picks: string[];
}

export function acceptBody(draft: Draft, edits: ReviewEdits): z.infer<typeof AcceptEnrichment> {
  const picked = new Set(edits.picks);
  return {
    draftVersion: draft.draftVersion,
    baseTextVersion: draft.baseTextVersion,
    bio: edits.bio.trim(),
    expertise: edits.expertise,
    evidenceIds: draft.evidence.filter((e) => picked.has(e.id)).map((e) => e.id),
  };
}

/**
 * Claims resting on evidence the person unticked (so may be wrong): worth a second look, never blocked.
 * Only evidence that started ticked counts, so CV excerpts left unticked raise nothing.
 */
export function claimsWithoutEvidence(draft: Draft, picks: string[], kept: string[]): { bio: boolean; expertise: string[] } {
  const picked = new Set(picks);
  const removed = new Set(initialPicks(draft).filter((id) => !picked.has(id)));
  return {
    bio: draft.bioEvidenceIds.some((id) => removed.has(id)),
    expertise: draft.expertise
      .filter((e) => kept.includes(e.label) && e.evidenceIds.some((id) => removed.has(id)) && !e.evidenceIds.some((id) => picked.has(id)))
      .map((e) => e.label),
  };
}

/** Facts the person hid from their card that this text still mentions. */
export function hiddenFacts(text: string, person: Person): string[] {
  const shown = person.visibility ?? SHOW_ALL;
  const lower = text.toLowerCase();
  const facts: string[] = [];
  const country = countryName(person.filters.country);
  if (!shown.country && country && lower.includes(country.toLowerCase())) facts.push(`your country (${country})`);
  const workplace = person.workplaceName;
  if (!shown.workplace && workplace && lower.includes(workplace.toLowerCase())) facts.push(`your workplace (${workplace})`);
  if (!shown.hiring && /\b(hiring|recruit\w*)\b/i.test(text)) facts.push("that you're hiring");
  return facts;
}

/** Pasted profile text has no page to name, so it's called what the person did. */
export function evidenceTitle(e: Evidence): string {
  return e.source === "public_profile" && !e.url ? "Text you pasted" : e.title;
}

/** keep: the person's newer bio wins; the draft can only be discarded, never approved over it. */
export type AcceptAction = "reload" | "signin" | "retry" | "keep";

export function acceptProblem(failure: { status: number; code: EnrichmentErrorCode | null }): { message: string; action: AcceptAction } {
  const { status, code } = failure;
  if (status === 401 || code === "sign_in_required") return { message: "Your sign-in has expired.", action: "signin" };
  if (code === "text_changed")
    return { message: "You changed your bio after this draft was written, so nothing was saved and your words are kept.", action: "keep" };
  if (code === "draft_superseded")
    return { message: "A newer draft replaced this one, so nothing was saved. Load the latest to review it.", action: "reload" };
  if (code === "consent_changed")
    return { message: "Your sources changed after this draft was written, so nothing was saved. Load the latest to review it.", action: "reload" };
  if (code === "invalid_input")
    return { message: "Some of this evidence is no longer available, so nothing was saved. Load the latest and try again.", action: "reload" };
  if (status === 0) return { message: "Lanyard couldn't be reached. Check your connection and try again.", action: "retry" };
  return { message: "Your bio wasn't saved. Try again in a moment.", action: "retry" };
}
