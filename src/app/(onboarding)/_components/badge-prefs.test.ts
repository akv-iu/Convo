import { describe, expect, it } from "vitest";
import {
  badgeColourScript,
  colourHex,
  DEFAULT_COLOUR,
  isBadgeColour,
  parseBadgePrefs,
  serializeBadgePrefs,
} from "./badge-prefs";

describe("badge preferences cookie", () => {
  it("round-trips the colour, decoded or URL-encoded", () => {
    const prefs = { colour: "sky" as const };
    expect(parseBadgePrefs(serializeBadgePrefs(prefs))).toEqual(prefs);
    expect(parseBadgePrefs(encodeURIComponent(serializeBadgePrefs(prefs)))).toEqual(prefs);
  });

  it("falls back to the default colour when missing or malformed", () => {
    expect(parseBadgePrefs(undefined)).toEqual({ colour: DEFAULT_COLOUR });
    expect(parseBadgePrefs("not json")).toEqual({ colour: DEFAULT_COLOUR });
    expect(parseBadgePrefs(serializeBadgePrefs({ colour: "neon" as never }))).toEqual({ colour: DEFAULT_COLOUR });
  });

  it("ignores fields it doesn't know, such as a workplace from an older build", () => {
    expect(parseBadgePrefs(JSON.stringify({ colour: "mint", workplace: "Acme Labs" }))).toEqual({ colour: "mint" });
  });

  it("knows its five colours", () => {
    expect(isBadgeColour("coral")).toBe(true);
    expect(isBadgeColour("red")).toBe(false);
    expect(colourHex("sunflower")).toBe("#ffd23f");
  });
});

describe("badgeColourScript", () => {
  function run(cookie: string) {
    const parent = { style: { props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v; } } };
    const document = { cookie, currentScript: { parentElement: parent } };
    new Function("document", badgeColourScript())(document);
    return parent.style.props["--badge"];
  }

  it("sets --badge from a saved colour", () => {
    expect(run(`a=1; convo_badge=${encodeURIComponent(JSON.stringify({ colour: "lilac" }))}`)).toBe("#c4b5fd");
  });

  it("leaves the default when there's no cookie, an unknown colour, or a broken value", () => {
    expect(run("a=1")).toBeUndefined();
    expect(run(`convo_badge=${encodeURIComponent(JSON.stringify({ colour: "neon" }))}`)).toBeUndefined();
    expect(run("convo_badge=%7Bbroken")).toBeUndefined();
  });
});
