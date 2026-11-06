import { describe, expect, it } from "vitest";
import { colourHex, DEFAULT_COLOUR, isBadgeColour, parseBadgePrefs, serializeBadgePrefs } from "./badge-prefs";

describe("badge preferences cookie", () => {
  it("round-trips colour and a typed workplace, decoded or URL-encoded", () => {
    const prefs = { colour: "sky" as const, workplace: "Acme Labs (100% remote)" };
    expect(parseBadgePrefs(serializeBadgePrefs(prefs))).toEqual(prefs);
    expect(parseBadgePrefs(encodeURIComponent(serializeBadgePrefs(prefs)))).toEqual(prefs);
  });

  it("falls back to the default colour when missing or malformed", () => {
    expect(parseBadgePrefs(undefined)).toEqual({ colour: DEFAULT_COLOUR });
    expect(parseBadgePrefs("not json")).toEqual({ colour: DEFAULT_COLOUR });
    expect(parseBadgePrefs(serializeBadgePrefs({ colour: "neon" as never }))).toEqual({ colour: DEFAULT_COLOUR });
  });

  it("drops a blank or overlong workplace but keeps the colour", () => {
    expect(parseBadgePrefs(encodeURIComponent(JSON.stringify({ colour: "mint", workplace: "  " })))).toEqual({ colour: "mint" });
    expect(parseBadgePrefs(encodeURIComponent(JSON.stringify({ colour: "mint", workplace: "x".repeat(201) })))).toEqual({
      colour: "mint",
    });
  });

  it("knows its five colours", () => {
    expect(isBadgeColour("coral")).toBe(true);
    expect(isBadgeColour("red")).toBe(false);
    expect(colourHex("sunflower")).toBe("#ffd23f");
  });
});
