import { describe, expect, it } from "vitest";
import { people } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import { visibleCard, visiblePerson } from "./visibility";

const match = {
  person: { ...people[0], workplaceName: "Acme", filters: { country: "US", rorId: "ror-acme", hiring: true } },
  badges: ["US", "hiring", "synthetic"], highlights: ["Repository evidence"], evidence: [],
  mutual: true, explanation: "Relevant experience", score: 1, rank: 0,
};
describe("card visibility", () => {
  it("removes hidden fields and their badges without mutating matching data", () => {
    const before = structuredClone(match);
    const card = visibleCard(match, { country: false, workplace: false, hiring: false });
    expect(card.person.filters).toEqual({ country: null, rorId: null, hiring: null });
    expect(card.person.workplaceName).toBeNull();
    expect(card.badges).toEqual(["synthetic"]);
    expect(card.person).not.toHaveProperty("visibility");
    expect(routes.match.response.parse([card])).toEqual([card]);
    expect(match).toEqual(before);
  });
  it("hides fields independently and preserves ranking, evidence and visible fields", () => {
    const card = visibleCard(match, { country: false, workplace: true, hiring: true });
    const { visibility: _settings, ...person } = match.person; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(card.person).not.toHaveProperty("visibility");
    expect(card).toMatchObject({ ...match, person: { ...person, filters: { ...match.person.filters, country: null } }, badges: ["hiring", "synthetic"] });
  });
  it("keeps older profiles visible by default", () => {
    expect(visibleCard({ ...match, person: { ...match.person, visibility: undefined } }).person.filters).toEqual(match.person.filters);
  });
  it("rejects malformed visibility rather than showing private fields", () => {
    expect(() => visibleCard(match, JSON.parse('{"country":null}'))).toThrow();
  });
});

describe("person visibility (request badges)", () => {
  it("uses the person's own settings, hides those sections and keeps the settings private", () => {
    const person = { ...match.person, visibility: { country: true, workplace: false, hiring: false } };
    const badge = visiblePerson(person);
    expect(badge).toMatchObject({ workplaceName: null, filters: { country: "US", rorId: null, hiring: null } });
    expect(badge).not.toHaveProperty("visibility");
    expect(person.workplaceName).toBe("Acme");
  });
});
