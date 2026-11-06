import { describe, expect, it } from "vitest";
import { parseConsent } from "./consent";

describe("GitHub consent cookie", () => {
  it.each([undefined, "", "email,all", "PROFILE", " profile ", "profile%2Crepos"])("grants nothing for %s", (value) => {
    expect(parseConsent(value)).toEqual([]);
  });

  it("accepts only explicit known sources, without duplicates", () => {
    expect(parseConsent("orgs,profile,profile,unknown,repos")).toEqual(["profile", "repos", "orgs"]);
  });
});
