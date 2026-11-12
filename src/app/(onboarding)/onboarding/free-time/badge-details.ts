/**
 * What step 3's badge shows: the same details as step 2. Step 1's answers still in this tab win
 * (they're what was just entered); the saved profile supplies the rest.
 */
import type { AvatarId, BadgeColour, Person, ProfileVisibility } from "@/contracts/types";
import type { Draft } from "../../_components/draft";
import { aboutFromProfile, SHOW_ALL, workplaceLabel } from "../answers";

export type BadgeDetails = {
  name: string;
  handle: string | null;
  country: string;
  avatar: AvatarId | null;
  /** The picture circle's own colour, or null to follow the badge. */
  avatarColour: BadgeColour | null;
  workplace: string | null;
  hiring: boolean | null;
  visibility: ProfileVisibility;
};

/**
 * Step 1's answers still in this tab win over the saved profile (they're what was just
 * entered); the saved profile supplies the rest. Null when there's neither.
 */
export function badgeDetails(p: Person | null, draft: Draft | null): BadgeDetails | null {
  if (!p && !draft) return null;
  return {
    name: draft?.name ?? p?.name ?? "",
    handle: p?.githubLogin ?? null,
    country: draft?.country ?? p?.filters.country ?? "",
    avatar: p?.avatar ?? null,
    avatarColour: p?.avatarColour ?? null,
    // The same label as step 2, including "Your saved workplace" for a listed one saved without its name.
    workplace: workplaceLabel(draft ? draft.workplace : p ? aboutFromProfile(p).workplace : null),
    hiring: p?.filters.hiring ?? null,
    visibility: p?.visibility ?? SHOW_ALL,
  };
}
