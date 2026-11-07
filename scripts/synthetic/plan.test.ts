import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ror } from "@/contracts/fixtures";
import { EvidenceDoc, Person } from "@/contracts/types";
import { COUNT, plan } from "./plan";

const people = plan().map(({ person }) => person);

describe("synthetic plan", () => {
  it("plans the same people every time, each once", () => {
    expect(plan().map(({ person }) => person)).toEqual(people);
    expect(people).toHaveLength(COUNT);
    expect(new Set(people.map((p) => p.id)).size).toBe(COUNT);
    expect(new Set(people.map((p) => p.name)).size).toBe(COUNT);
  });

  it("labels everyone synthetic, with a demo- login that can't link to a real GitHub account", () => {
    expect(new Set(people.map((p) => p.githubLogin)).size).toBe(COUNT);
    for (const person of people) {
      expect(person.synthetic).toBe(true);
      expect(person.githubLogin).toMatch(/^demo-[a-z]+-[a-z]+$/);
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
});

describe("people.json", () => {
  const file = JSON.parse(readFileSync("scripts/synthetic/people.json", "utf8"));
  const saved = Person.array().parse(file.people);
  const evidence = EvidenceDoc.array().parse(file.evidence);
  const textOf = (person: Person) =>
    [person.bio, ...evidence.filter((doc) => doc.personId === person.id).flatMap((doc) => [doc.title, doc.text])].join(" ");

  it("holds exactly the planned people, so a plan change can't go out without regenerating", () => {
    expect(saved.map((person) => ({ ...person, bio: "" }))).toEqual(people);
    expect(saved.every((person) => person.bio.length > 0)).toBe(true);
  });

  it("gives each attendee two to four evidence items of their own", () => {
    const counts = new Map<string, number>();
    for (const doc of evidence) counts.set(doc.personId, (counts.get(doc.personId) ?? 0) + 1);
    expect(new Set(counts.keys())).toEqual(new Set(saved.map((person) => person.id)));
    for (const count of counts.values()) {
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(4);
    }
    expect(new Set(evidence.map((doc) => doc.id)).size).toBe(evidence.length);
  });

  it("never reveals a workplace, links anywhere, or claims a fixture expert's niche", () => {
    const niches = ["loki", "tempo", "opentelemetry collector", "argo cd", "gang scheduling", "cilium", "kube-proxy", "sigstore", "cosign", "netflix", "grafana", "preemption"];
    for (const person of saved) {
      const text = textOf(person);
      if (person.workplaceName) expect(text).not.toContain(person.workplaceName);
      expect(text).not.toMatch(/https?:/);
      for (const niche of niches) expect(text.toLowerCase()).not.toContain(niche);
    }
    expect(evidence.some((doc) => doc.url)).toBe(false);
  });
});
