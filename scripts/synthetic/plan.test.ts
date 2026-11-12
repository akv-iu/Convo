import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ror } from "@/contracts/fixtures";
import { EvidenceDoc, Person } from "@/contracts/types";
import { COUNT, FIELD_LABELS, MAX_ITEMS, MIN_ITEMS, plan, unusable } from "./plan";

const planned = plan();
const people = planned.map(({ person }) => person);

describe("synthetic plan", () => {
  it("plans the same people every time, each once", () => {
    expect(plan().map(({ person }) => person)).toEqual(people);
    expect(people).toHaveLength(COUNT);
    expect(new Set(people.map((p) => p.id)).size).toBe(COUNT);
    expect(new Set(people.map((p) => p.name)).size).toBe(COUNT);
  });

  it("plans between 100 and 200 people across every field, tech and medical alike", () => {
    expect(COUNT).toBeGreaterThanOrEqual(100);
    expect(COUNT).toBeLessThanOrEqual(200);
    const medical = new Set(FIELD_LABELS.filter((f) => f.medical).map((f) => f.label));
    for (const { label } of FIELD_LABELS) expect(planned.filter((p) => p.field === label).length).toBeGreaterThanOrEqual(4);
    expect(planned.filter((p) => medical.has(p.field)).length).toBeGreaterThanOrEqual(40);
    expect(planned.filter((p) => !medical.has(p.field)).length).toBeGreaterThanOrEqual(80);
  });

  it("labels everyone synthetic, with a demo- login that can't link to a real GitHub account", () => {
    expect(new Set(people.map((p) => p.githubLogin)).size).toBe(COUNT);
    for (const person of people) {
      expect(person.synthetic).toBe(true);
      expect(person.githubLogin).toMatch(/^demo-[a-z]+-[a-z]+$/);
    }
  });

  it("gives everyone languages, organisations and expertise the person finder can match", () => {
    for (const person of people) {
      expect(person.languages.length).toBeGreaterThanOrEqual(1);
      expect(person.organisations.length).toBeGreaterThanOrEqual(1);
      expect(person.expertise?.length).toBeGreaterThanOrEqual(2);
      expect(Person.parse(person)).toEqual(person); // expertise within the contract's 8 labels of 60 characters
    }
  });

  it("gives the two people on one focus different roles and a secondary interest of their own", () => {
    for (let i = 0; i < planned.length; i += 2) {
      expect(planned[i].focus).toBe(planned[i + 1].focus);
      expect(planned[i].role).not.toBe(planned[i + 1].role);
    }
    for (const p of planned) expect(p.also).not.toBe(p.focus);
  });

  it("plans six to nine evidence items of at least three kinds for everyone", () => {
    for (const { mix } of planned) {
      const total = Object.values(mix).reduce((sum, n) => sum + n, 0);
      expect(total).toBeGreaterThanOrEqual(MIN_ITEMS);
      expect(total).toBeLessThanOrEqual(MAX_ITEMS);
      expect(Object.keys(mix).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("leaves Grafana Labs and Netflix to the fixture experts, and only uses real ROR IDs", () => {
    for (const person of people) {
      expect(["Grafana Labs", "Netflix"]).not.toContain(person.workplaceName);
      if (person.filters.rorId) expect(ror.find((org) => org.id === person.filters.rorId)?.name).toBe(person.workplaceName);
    }
  });

  it("gives one to three free blocks between 09:00 and 17:30 that never overlap", () => {
    for (const { freeTimes } of people) {
      expect(freeTimes.length).toBeGreaterThanOrEqual(1);
      expect(freeTimes.length).toBeLessThanOrEqual(3);
      for (const [i, { start, end }] of freeTimes.entries()) {
        expect(start < end).toBe(true);
        expect(start.slice(11, 16) >= "09:00" && end.slice(11, 16) <= "17:30").toBe(true);
        if (i > 0) expect(freeTimes[i - 1].end <= start).toBe(true);
      }
    }
  });

  it("rejects text that reveals a workplace or country, links anywhere, claims a fixture niche or isn't about \"them\"", () => {
    const person = { ...people[0], workplaceName: "Mayo Clinic", filters: { ...people[0].filters, country: "GB" } };
    expect(unusable(person, "Studies sepsis alerts at Mayo Clinic.")).toMatch(/workplace/);
    expect(unusable(person, "Built for hospitals across the United Kingdom.")).toMatch(/country/);
    expect(unusable(person, "Linked NHS trust records.")).toMatch(/health system/);
    expect(unusable(person, "See https://example.org.")).toMatch(/link/);
    expect(unusable(person, "Tuned Loki retention.")).toMatch(/niche/);
    expect(unusable(person, "She maintains the importer.")).toMatch(/gendered/);
    expect(unusable(person, "Sepsis models. I also mentor students.")).toMatch(/first person/);
    expect(unusable(person, "Spatiotemporal models of sepsis onset in a Phase I trial; they report HER2 status.")).toBeUndefined();
  });
});

describe("people.json", () => {
  const file = JSON.parse(readFileSync("scripts/synthetic/people.json", "utf8"));
  const saved = Person.array().parse(file.people);
  const evidence = EvidenceDoc.array().parse(file.evidence);
  const docsOf = (person: Person) => evidence.filter((doc) => doc.personId === person.id);

  it("holds exactly the planned people, so a plan change can't go out without regenerating", () => {
    expect(saved.map((person) => ({ ...person, bio: "" }))).toEqual(people);
    expect(saved.every((person) => person.bio.length > 0)).toBe(true);
  });

  it("gives each attendee six to nine evidence items of their own, with every kind the plan asked for", () => {
    expect(new Set(evidence.map((doc) => doc.personId))).toEqual(new Set(saved.map((person) => person.id)));
    for (const [i, person] of saved.entries()) {
      const docs = docsOf(person);
      expect(docs.length).toBeGreaterThanOrEqual(MIN_ITEMS);
      expect(docs.length).toBeLessThanOrEqual(MAX_ITEMS);
      const kinds = new Set<string>(docs.map((doc) => doc.kind));
      for (const kind of Object.keys(planned[i].mix)) expect(kinds).toContain(kind);
    }
    expect(new Set(evidence.map((doc) => doc.id)).size).toBe(evidence.length);
  });

  it("never reveals a workplace or country, links anywhere, claims a fixture expert's niche or uses he, she or I", () => {
    for (const person of saved) {
      const text = [person.bio, ...docsOf(person).flatMap((doc) => [doc.title, doc.text])].join(" ");
      expect(unusable(person, text), person.id).toBeUndefined();
    }
    expect(evidence.some((doc) => doc.url)).toBe(false);
  });
});
