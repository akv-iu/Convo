import { describe, expect, it } from "vitest";
import { HardFilters } from "@/contracts/types";
import { aboutYouMissing, missingAnswers, NAME_MAX, saveErrorMessage, toFilters, workplaceLabel, type Answers } from "./answers";

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
