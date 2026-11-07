/**
 * Badge colours shared by every screen that draws a badge or card: the
 * user's own badge in onboarding (A1) and other people's cards on the
 * match screen (A2). The IDs are the contract's BadgeColour values.
 */
import type { BadgeColour } from "@/contracts/types";

export type { BadgeColour };

export const badgeColours = [
  { id: "sunflower", name: "Sunflower", hex: "#ffd23f" },
  { id: "mint", name: "Mint", hex: "#5ee6b4" },
  { id: "sky", name: "Sky", hex: "#7dd3fc" },
  { id: "lilac", name: "Lilac", hex: "#c4b5fd" },
  { id: "coral", name: "Coral", hex: "#ffa38a" },
] as const satisfies readonly { id: BadgeColour; name: string; hex: string }[];

export const DEFAULT_COLOUR: BadgeColour = "sunflower";

export const colourIds = badgeColours.map((c) => c.id) as [BadgeColour, ...BadgeColour[]];

export function isBadgeColour(value: unknown): value is BadgeColour {
  return typeof value === "string" && (colourIds as string[]).includes(value);
}

export function colourHex(id: BadgeColour): string {
  return badgeColours.find((c) => c.id === id)?.hex ?? badgeColours[0].hex;
}
