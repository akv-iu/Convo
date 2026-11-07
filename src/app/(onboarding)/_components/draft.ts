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
});
export type Draft = z.infer<typeof Draft>;

export function saveDraft(draft: Draft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Private mode or storage disabled: step 2 falls back to the saved profile or step 1.
  }
}

export function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = Draft.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
