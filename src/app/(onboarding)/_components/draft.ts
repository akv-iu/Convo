/**
 * Step 1's answers (name, country, workplace), held in the browser tab
 * until step 2 can save them.
 *
 * Why not save them at once: before GitHub sign-in there is no account,
 * and B2's PUT /api/me needs country, workplace and hiring together
 * (db/Profile-API.md), and hiring is asked on step 2. sessionStorage
 * survives the GitHub redirect in the same tab and never leaves the
 * browser; it's cleared once step 2 saves.
 */
import { z } from "zod";
import { RorMatch } from "@/contracts/types";
import { SourceChoices } from "./enrichment";

const KEY = "convo_onboarding_draft";

export const Workplace = z.union([
  z.object({ kind: z.literal("org"), org: RorMatch }),
  z.object({ kind: z.literal("custom"), name: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.literal("none") }),
]);
export type Workplace = z.infer<typeof Workplace> | null;

export const Draft = z.object({
  name: z.string().trim().min(1).max(80),
  country: z.string().length(2),
  workplace: Workplace,
  /** Profile enrichment's page one only: an ORCID iD and which sources to import. */
  orcid: z.string().nullable().optional(),
  sources: SourceChoices.optional(),
});
export type Draft = z.infer<typeof Draft>;

export function saveDraft(draft: Draft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Private mode or storage disabled: step 2 falls back to the saved profile or step 1.
  }
}

/** The stored draft as text: a stable snapshot for useSyncExternalStore. */
export function draftSnapshot(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function parseDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const parsed = Draft.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readDraft(): Draft | null {
  return parseDraft(draftSnapshot());
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
