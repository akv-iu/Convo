/**
 * Page five with profile enrichment on: what to show for the import job, what the
 * approval sends, and the warnings shown before approving. Nothing generated is
 * published until the person approves it (POST /api/profile-enrichment/:id/accept).
 */
import type { AcceptEnrichment, EnrichmentErrorCode, EnrichmentJob } from "@/contracts/enrichment";
import { countryName } from "@/components/ui/countries";
import type { Person } from "@/contracts/types";
import { ENRICHMENT_TAB_KEYS } from "../../_components/draft";
import { SHOW_ALL } from "../answers";
import { z } from "zod";

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

/**
 * What the person changed on page five, kept for one import in this tab, so a
 * retry, a newer draft or a refresh doesn't lose it. bio and expertise are kept
 * only once edited (otherwise a newer draft's text is used); seen lists every
 * evidence ID already shown, so a pick the person removed stays removed.
 */
export const KeptEdits = z.object({
  jobId: z.string(),
  bio: z.string().max(BIO_MAX).optional(),
  expertise: z.array(z.string().max(EXPERTISE.chip)).max(EXPERTISE.chips).optional(),
  picks: z.array(z.string()).max(200),
  seen: z.array(z.string()).max(200),
});
export type KeptEdits = z.infer<typeof KeptEdits>;

const labels = (draft: Draft) => draft.expertise.map((e) => e.label);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The editor's starting point for a draft: the person's own bio and expertise if they
 * edited them, else the draft's. Evidence picks survive only where that evidence is
 * still in the draft; evidence new to the person starts as usual (CV excerpts unticked).
 */
export function carryEdits(draft: Draft, kept: KeptEdits | null): ReviewEdits {
  if (!kept) return { bio: draft.bio, expertise: labels(draft), picks: initialPicks(draft) };
  const picked = new Set(kept.picks);
  const seen = new Set(kept.seen);
  return {
    bio: kept.bio ?? draft.bio,
    expertise: kept.expertise ?? labels(draft),
    picks: draft.evidence.filter((e) => (seen.has(e.id) ? picked.has(e.id) : e.source !== "cv")).map((e) => e.id),
  };
}

/** What to remember of the current edits; evidence shown by this import's earlier drafts stays seen. */
export function keepEdits(jobId: string, draft: Draft, edits: ReviewEdits, previous: KeptEdits | null): KeptEdits {
  const seen = new Set([...(previous?.jobId === jobId ? previous.seen : []), ...draft.evidence.map((e) => e.id)]);
  return {
    jobId,
    ...(edits.bio === draft.bio ? {} : { bio: edits.bio }),
    ...(sameList(edits.expertise, labels(draft)) ? {} : { expertise: edits.expertise }),
    picks: edits.picks,
    seen: [...seen].slice(-200),
  };
}

const KEPT_KEY = ENRICHMENT_TAB_KEYS.review;

/** This tab's kept edits for jobId, or null (none, another import's, unreadable or blocked storage). */
export function readKept(jobId: string): KeptEdits | null {
  try {
    const parsed = KeptEdits.safeParse(JSON.parse(sessionStorage.getItem(KEPT_KEY) ?? "null"));
    return parsed.success && parsed.data.jobId === jobId ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Remembers the edits, or forgets them (null) once approved or discarded. */
export function saveKept(kept: KeptEdits | null): void {
  try {
    if (kept) sessionStorage.setItem(KEPT_KEY, JSON.stringify(kept));
    else sessionStorage.removeItem(KEPT_KEY);
  } catch {
    // Storage blocked: edits still work on this page, they just don't survive a reload.
  }
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
