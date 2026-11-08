import { describe, expect, it } from "vitest";
import { HardFilters } from "@/contracts/types";
import {
  aboutFromProfile,
  aboutYouMissing,
  missingAnswers,
  NAME_MAX,
  sameName,
  saveErrorMessage,
  SHOW_ALL,
  toFilters,
  toProfileBody,
  workplaceLabel,
  type Answers,
} from "./answers";
import { routes } from "@/contracts/routes";

const stanford = { id: "https://ror.org/00f54p054", name: "Stanford University", country: "US" };
const complete: Answers = { name: "Ada", workplace: { kind: "org", org: stanford }, country: "US", hiring: true };

describe("aboutYouMissing (step 1)", () => {
  it("lists name, workplace and country in screen order", () => {
    expect(aboutYouMissing({ name: " ", workplace: null, country: "" })).toEqual(["name", "workplace", "country"]);
  });

  it("is empty once all three are answered, without hiring", () => {
    expect(aboutYouMissing({ name: "Ada", workplace: { kind: "none" }, country: "GB" })).toEqual([]);
  });

  it("refuses an overlong name and an unknown country", () => {
    expect(aboutYouMissing({ name: "x".repeat(NAME_MAX + 1), workplace: { kind: "none" }, country: "ZZ" })).toEqual([
      "name",
      "country",
    ]);
  });
});

describe("missingAnswers (step 2 save)", () => {
  it("adds hiring to step 1's questions", () => {
    expect(missingAnswers({ ...complete, hiring: null })).toEqual(["hiring"]);
    expect(missingAnswers(complete)).toEqual([]);
  });

  it("counts 'Not with an organisation' and 'Not right now' as answers", () => {
    expect(missingAnswers({ name: "Ada", workplace: { kind: "none" }, country: "CA", hiring: false })).toEqual([]);
  });
});

describe("toFilters", () => {
  it("sends the workplace's ROR ID, the country and hiring, matching the contract", () => {
    const filters = toFilters(complete);
    expect(filters).toEqual({ country: "US", rorId: stanford.id, hiring: true });
    expect(HardFilters.parse(filters)).toEqual(filters);
  });

  it("sends a null rorId for 'Not with an organisation'", () => {
    expect(toFilters({ name: "Ada", workplace: { kind: "none" }, country: "gb", hiring: false })).toEqual({
      country: "GB",
      rorId: null,
      hiring: false,
    });
  });

  it("refuses incomplete answers", () => {
    expect(() => toFilters({ ...complete, hiring: null })).toThrow();
  });
});

describe("workplaceLabel", () => {
  it("names each kind of answer for the badge", () => {
    expect(workplaceLabel(null)).toBeNull();
    expect(workplaceLabel({ kind: "none" })).toBe("Independent");
    expect(workplaceLabel({ kind: "org", org: stanford })).toBe("Stanford University");
  });
});

describe("saveErrorMessage", () => {
  it("asks the user to sign in again on 401", () => {
    expect(saveErrorMessage(401, { error: "sign in first" })).toMatch(/sign in again/i);
    // A deleted profile (404) is the same: only signing in again can fix it.
    expect(saveErrorMessage(404, { error: "Profile not found. Sign in again." })).toMatch(/sign in again/i);
  });

  it("passes on the server's retry message on 503", () => {
    expect(saveErrorMessage(503, { error: "Profile saved; search update failed. Retry the same save." })).toBe(
      "Profile saved; search update failed. Retry the same save.",
    );
  });

  it("has a fallback for 503 without a message, 400, and network failures", () => {
    expect(saveErrorMessage(503, null)).toMatch(/try again/i);
    expect(saveErrorMessage(400, { error: "bad request" })).toMatch(/wasn't accepted/);
    expect(saveErrorMessage(0, null)).toMatch(/weren't saved/);
  });
});

describe("typed workplaces (not in the directory)", () => {
  const acme: Answers = { ...complete, workplace: { kind: "custom", name: "  Acme Robotics  " } };

  it("count as answered, with no ROR ID", () => {
    expect(missingAnswers(acme)).toEqual([]);
    expect(toFilters(acme).rorId).toBeNull();
    expect(workplaceLabel(acme.workplace)).toBe("Acme Robotics");
  });

  it("must have a name of 1 to 200 characters", () => {
    expect(aboutYouMissing({ ...acme, workplace: { kind: "custom", name: "   " } })).toEqual(["workplace"]);
    expect(aboutYouMissing({ ...acme, workplace: { kind: "custom", name: "x".repeat(201) } })).toEqual(["workplace"]);
  });
});

describe("toProfileBody (step 2 save, db/Frontend-Support.md)", () => {
  const hidden = { country: false, workplace: true, hiring: false };

  it("sends a directory workplace's name with its ROR ID, the colour and the whole visibility object", () => {
    const body = toProfileBody(complete, "lilac", hidden);
    expect(body).toEqual({
      name: "Ada",
      filters: { country: "US", rorId: stanford.id, hiring: true },
      workplaceName: "Stanford University",
      badgeColour: "lilac",
      visibility: hidden,
      avatar: null, // no picture chosen: initials
    });
    expect(toProfileBody(complete, "lilac", hidden, "moon").avatar).toBe("moon");
    expect(routes.putMe.body.safeParse(body).success).toBe(true);
  });

  it("sends a typed workplace as a name with no ROR ID, and independent as neither", () => {
    expect(toProfileBody({ ...complete, workplace: { kind: "custom", name: " Acme " } }, "sunflower", SHOW_ALL)).toMatchObject({
      filters: { rorId: null },
      workplaceName: "Acme",
    });
    const independent = toProfileBody({ ...complete, workplace: { kind: "none" } }, "sunflower", SHOW_ALL);
    expect(independent).toMatchObject({ filters: { rorId: null }, workplaceName: null });
    expect(routes.putMe.body.safeParse(independent).success).toBe(true);
  });
});

describe("aboutFromProfile (restoring a saved profile)", () => {
  const filters = { country: "GB", rorId: null, hiring: false };

  it("rebuilds directory, typed and independent workplaces", () => {
    expect(aboutFromProfile({ name: "Ada", filters: { ...filters, rorId: stanford.id }, workplaceName: "Stanford University" }).workplace).toEqual({
      kind: "org",
      org: { id: stanford.id, name: "Stanford University", country: "GB" },
    });
    expect(aboutFromProfile({ name: "Ada", filters, workplaceName: "Acme" }).workplace).toEqual({ kind: "custom", name: "Acme" });
    expect(aboutFromProfile({ name: "Ada", filters, workplaceName: null }).workplace).toEqual({ kind: "none" });
  });

  it("falls back to a generic label for older profiles that only kept the ROR ID", () => {
    const about = aboutFromProfile({ name: "Ada", filters: { ...filters, rorId: stanford.id } });
    expect(workplaceLabel(about.workplace)).toBe("Your saved workplace");
    // ...but never saves that placeholder as the workplace's name.
    const body = toProfileBody({ ...about, hiring: false }, "sunflower", SHOW_ALL);
    expect(body).toMatchObject({ filters: { rorId: stanford.id }, workplaceName: null });
  });
});

describe("sameName (no 'Use …' option for a name already listed)", () => {
  it("ignores case and extra spaces", () => {
    expect(sameName("University of Utah", "  university  of utah ")).toBe(true);
    expect(sameName("University of Utah", "University of Utah Health")).toBe(false);
  });
});
