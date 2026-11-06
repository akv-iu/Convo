/**
 * How the user's badge looks: its colour. Kept in the browser in the
 * `convo_badge` cookie.
 *
 * Frontend-only. The backend doesn't read this cookie, and the colour isn't
 * in the Person contract, so other people never see it. Showing it to
 * others needs a contract field from B.
 */
import { z } from "zod";

export const BADGE_COOKIE = "convo_badge";
const ONE_YEAR = 60 * 60 * 24 * 365;

export const badgeColours = [
  { id: "sunflower", name: "Sunflower", hex: "#ffd23f" },
  { id: "mint", name: "Mint", hex: "#5ee6b4" },
  { id: "sky", name: "Sky", hex: "#7dd3fc" },
  { id: "lilac", name: "Lilac", hex: "#c4b5fd" },
  { id: "coral", name: "Coral", hex: "#ffa38a" },
] as const;

export type BadgeColour = (typeof badgeColours)[number]["id"];
export const DEFAULT_COLOUR: BadgeColour = "sunflower";

const colourIds = badgeColours.map((c) => c.id) as [BadgeColour, ...BadgeColour[]];

const Prefs = z.object({
  colour: z.enum(colourIds).catch(DEFAULT_COLOUR).default(DEFAULT_COLOUR),
});
export type BadgePrefs = z.infer<typeof Prefs>;

export function isBadgeColour(value: unknown): value is BadgeColour {
  return typeof value === "string" && (colourIds as string[]).includes(value);
}

export function colourHex(id: BadgeColour): string {
  return badgeColours.find((c) => c.id === id)?.hex ?? badgeColours[0].hex;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    // document.cookie gives the raw, URL-encoded value
    try {
      return JSON.parse(decodeURIComponent(value));
    } catch {
      return {};
    }
  }
}

/**
 * Reads the cookie value, decoded (as Next's cookies().get gives it) or
 * raw (as document.cookie gives it). Anything missing or malformed falls
 * back to defaults.
 */
export function parseBadgePrefs(value: string | undefined): BadgePrefs {
  const parsed = Prefs.safeParse(value ? parseJson(value) : {});
  return parsed.success ? parsed.data : { colour: DEFAULT_COLOUR };
}

/** Plain JSON. Next's cookies().set encodes it; the browser writer encodes it itself. */
export function serializeBadgePrefs(prefs: BadgePrefs): string {
  return JSON.stringify(prefs);
}

export const badgeCookieOptions = { path: "/", sameSite: "lax" as const, maxAge: ONE_YEAR };

/** Reads the prefs from document.cookie (browser only). */
export function readBadgePrefs(): BadgePrefs {
  return parseBadgePrefs(
    document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${BADGE_COOKIE}=`))
      ?.slice(BADGE_COOKIE.length + 1),
  );
}

/**
 * A tiny script for the onboarding layout: sets --badge on its parent
 * element from the cookie before first paint, so a fresh page load never
 * flashes the default colour. Built from the same colour list.
 */
export function badgeColourScript(): string {
  const hexes = JSON.stringify(Object.fromEntries(badgeColours.map((c) => [c.id, c.hex])));
  return `(function(){try{var el=document.currentScript&&document.currentScript.parentElement;var m=document.cookie.match(/(?:^|; )${BADGE_COOKIE}=([^;]*)/);if(!el||!m)return;var p=JSON.parse(decodeURIComponent(m[1]));var c=${hexes}[p.colour];if(c)el.style.setProperty("--badge",c)}catch(e){}})();`;
}

/** Browser-side update, merging into what's already saved. */
export function writeBadgePrefs(patch: Partial<BadgePrefs>): BadgePrefs {
  const next = Prefs.parse({ ...readBadgePrefs(), ...patch });
  document.cookie = `${BADGE_COOKIE}=${encodeURIComponent(serializeBadgePrefs(next))}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  return next;
}

/**
 * Shows a saved profile's colour on this page and keeps it for the next
 * steps. The profile (GET /api/me badgeColour) is the source of truth;
 * the cookie is only how the colour reaches the first paint of each step.
 */
export function showSavedColour(colour: BadgeColour | undefined): BadgeColour {
  const next = colour ?? DEFAULT_COLOUR;
  writeBadgePrefs({ colour: next });
  document.querySelector<HTMLElement>(".onb")?.style.setProperty("--badge", colourHex(next));
  return next;
}
