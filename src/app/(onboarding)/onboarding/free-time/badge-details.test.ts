import { describe, expect, it } from "vitest";
import { people } from "@/contracts/fixtures";
import { badgeDetails } from "./badge-details";

const saved = { ...structuredClone(people[0]), workplaceName: "Acme", visibility: { country: false, workplace: true, hiring: true } };

describe("step 3's badge details", () => {
  it("uses step 1's answers still in this tab over the saved profile, and the saved rest", () => {
    const draft = { name: "Ada Lovelace", country: "GB", workplace: { kind: "custom" as const, name: "Analytical Engines" } };
    expect(badgeDetails(saved, draft)).toEqual({
      name: "Ada Lovelace",
      handle: saved.githubLogin,
      country: "GB",
      avatar: null,
      workplace: "Analytical Engines",
      hiring: saved.filters.hiring,
      visibility: saved.visibility,
    });
  });

  it("uses the saved profile, with its show/hide choices, once step 1 is saved", () => {
    expect(badgeDetails({ ...saved, avatar: "moon" }, null)).toMatchObject({
      name: saved.name,
      country: saved.filters.country,
      workplace: "Acme",
      avatar: "moon",
      visibility: saved.visibility,
    });
  });

  it("labels a listed workplace saved without its name the way step 2 does", () => {
    const listed = { ...saved, workplaceName: null, filters: { ...saved.filters, rorId: "https://ror.org/052gg0110" } };
    expect(badgeDetails(listed, null)?.workplace).toBe("Your saved workplace");
  });

  it("works from step 1's answers alone before a profile exists, showing everything", () => {
    const details = badgeDetails(null, { name: "Ada", country: "GB", workplace: { kind: "none" } });
    expect(details).toMatchObject({ name: "Ada", handle: null, country: "GB", workplace: "Independent", hiring: null });
    expect(details?.visibility).toEqual({ country: true, workplace: true, hiring: true });
    expect(badgeDetails(null, null)).toBeNull();
  });
});
