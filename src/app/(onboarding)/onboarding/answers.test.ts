import { describe, expect, it } from "vitest";
import { HardFilters } from "@/contracts/types";
import { missingAnswers, saveErrorMessage, toFilters, type Answers } from "./answers";

const stanford = { id: "https://ror.org/00f54p054", name: "Stanford University", country: "US" };
const complete: Answers = { workplace: { kind: "org", org: stanford }, country: "US", hiring: true };

describe("missingAnswers", () => {
  it("lists every unanswered question in screen order", () => {
    expect(missingAnswers({ workplace: null, country: "", hiring: null })).toEqual(["workplace", "country", "hiring"]);
  });

  it("is empty when all three are answered", () => {
    expect(missingAnswers(complete)).toEqual([]);
  });

  it("counts 'Not with an organisation' and 'Not right now' as answers", () => {
    expect(missingAnswers({ workplace: { kind: "none" }, country: "CA", hiring: false })).toEqual([]);
  });

  it("rejects a country that isn't a known code", () => {
    expect(missingAnswers({ ...complete, country: "ZZ" })).toEqual(["country"]);
  });
});

describe("toFilters", () => {
  it("sends the workplace's ROR ID, the country and hiring, matching the contract", () => {
    const filters = toFilters(complete);
    expect(filters).toEqual({ country: "US", rorId: stanford.id, hiring: true });
    expect(HardFilters.parse(filters)).toEqual(filters);
  });

  it("sends a null rorId for 'Not with an organisation'", () => {
    expect(toFilters({ workplace: { kind: "none" }, country: "gb", hiring: false })).toEqual({
      country: "GB",
      rorId: null,
      hiring: false,
    });
  });

  it("refuses incomplete answers", () => {
    expect(() => toFilters({ ...complete, hiring: null })).toThrow();
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
