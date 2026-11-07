import { describe, expect, it } from "vitest";
import { ror } from "@/contracts/fixtures";
import { countries, countryName, isCountryCode } from "./countries";

describe("countries", () => {
  it("has every code once, sorted by name", () => {
    const codes = countries.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBeGreaterThanOrEqual(249);
    const names = countries.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("knows every country the fixture workplaces use", () => {
    for (const org of ror) expect(isCountryCode(org.country), org.country).toBe(true);
  });

  it("names codes in any case and falls back to the code", () => {
    expect(countryName("us")).toBe("United States");
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("QQ")).toBe("QQ");
    expect(isCountryCode("QQ")).toBe(false);
  });
});
