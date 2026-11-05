/**
 * In-memory search over the fixtures. Keyword overlap stands in for hybrid
 * search; good enough for the screens and the contract tests.
 */
import * as fixtures from "@/contracts/fixtures";
import type { EvidenceDoc, Person, TimeBlock } from "@/contracts/types";
import type { Candidate, SearchService } from "./index";

const people = new Map<string, Person>(fixtures.people.map((p) => [p.id, p]));
const evidence = new Map<string, EvidenceDoc[]>();
for (const e of fixtures.evidence) {
  evidence.set(e.personId, [...(evidence.get(e.personId) ?? []), e]);
}
const asks = new Map<string, string[]>(); // userId -> ask texts

const STOP = new Set(["i", "a", "an", "the", "to", "at", "in", "on", "of", "how", "want", "works", "work", "does", "do", "with", "and", "for", "is", "it", "my", "me", "get", "specifically", "what", "about"]);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function overlaps(a: TimeBlock[], b: TimeBlock[]): boolean {
  return a.some((x) => b.some((y) => Date.parse(x.start) < Date.parse(y.end) && Date.parse(y.start) < Date.parse(x.end)));
}

export const memorySearch: SearchService = {
  async ingestPerson(person, docs) {
    people.set(person.id, person);
    if (docs !== undefined) evidence.set(person.id, docs);
  },

  async searchCandidates(query, filters, limit = 10) {
    const q = new Set(tokens(query));
    const exclude = new Set(filters.excludeIds);
    const out: Candidate[] = [];
    for (const person of people.values()) {
      if (exclude.has(person.id)) continue;
      const highlights: string[] = [];
      let score = 0;
      for (const doc of evidence.get(person.id) ?? []) {
        const hit = tokens(`${doc.title} ${doc.text}`).filter((t) => q.has(t));
        if (hit.length) {
          score += new Set(hit).size;
          highlights.push(doc.title);
        }
      }
      const bioHits = tokens(`${person.bio} ${person.organisations.join(" ")}`).filter((t) => q.has(t));
      score += new Set(bioHits).size * 0.5;
      if (score === 0) continue;
      if (filters.freeTimes && overlaps(filters.freeTimes, person.freeTimes)) score += 0.5;
      out.push({ person, highlights, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  },

  async registerAsk(userId, askText) {
    asks.set(userId, [...(asks.get(userId) ?? []), askText]);
  },

  async whoIsLookingFor(person) {
    const fromFixtures = Object.entries(fixtures.lookingFor)
      .filter(([, ids]) => ids.includes(person.id))
      .map(([userId]) => userId);
    const profile = new Set(tokens(`${person.bio} ${(evidence.get(person.id) ?? []).map((e) => e.title).join(" ")}`));
    const fromAsks = [...asks.entries()]
      .filter(([userId, texts]) => userId !== person.id && texts.some((t) => tokens(t).some((w) => profile.has(w))))
      .map(([userId]) => userId);
    return [...new Set([...fromFixtures, ...fromAsks])];
  },

  async getAvailability(ids) {
    return Object.fromEntries(ids.map((id) => [id, people.get(id)?.freeTimes ?? []]));
  },
};

export function getPerson(id: string): Person | undefined {
  return people.get(id);
}
