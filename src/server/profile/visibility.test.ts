import { describe, expect, it } from "vitest";
import { people } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import { visibleCard } from "./visibility";

const match = {
  person: { ...people[0], workplaceName: "Acme", filters: { country: "US", rorId: "ror-acme", hiring: true } },
  badges: ["US", "hiring", "synthetic"], highlights: ["Repository evidence"],
  mutual: true, explanation: "Relevant experience", score: 1, rank: 0,
};
describe("card visibility", () => {
  it("removes hidden fields and their badges without mutating matching data", () => {
    const before = structuredClone(match);
    const card = visibleCard(match, { country: false, workplace: false, hiring: false });
    expect(card.person.filters).toEqual({ country: null, rorId: null, hiring: null });
    expect(card.person.workplaceName).toBeNull();
    expect(card.badges).toEqual(["synthetic"]);
    expect(routes.match.response.parse([card])).toEqual([card]);
    expect(match).toEqual(before);
  });
  it("hides fields independently and preserves ranking, evidence and visible fields", () => {
    const card = visibleCard(match, { country: false, workplace: true, hiring: true });
    expect(card).toMatchObject({ ...match, person: { ...match.person, visibility: { country: false, workplace: true, hiring: true }, filters: { ...match.person.filters, country: null } }, badges: ["hiring", "synthetic"] });
  });
  it("keeps older profiles visible by default", () => {
    expect(visibleCard({ ...match, person: { ...match.person, visibility: undefined } }).person.filters).toEqual(match.person.filters);
  });
  it("rejects malformed visibility rather than showing private fields", () => {
    expect(() => visibleCard(match, JSON.parse('{"country":null}'))).toThrow();
  });
});
