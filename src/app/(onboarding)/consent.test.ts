import { describe, expect, it } from "vitest";
import { parseConsent } from "./consent";

describe("parseConsent", () => {
  it("reads the sources the user agreed to", () => {
    expect(parseConsent("profile,repos")).toEqual(["profile", "repos"]);
  });

  it("treats a missing or empty cookie as no optional sources", () => {
    expect(parseConsent(undefined)).toEqual([]);
    expect(parseConsent("")).toEqual([]);
  });

  it("ignores anything that is not a known source", () => {
    expect(parseConsent("orgs,email,../etc")).toEqual(["orgs"]);
  });
});
