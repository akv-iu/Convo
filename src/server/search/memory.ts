/**
 * In-memory search over the fixtures. Keyword overlap stands in for hybrid
 * search; good enough for the screens and the contract tests.
 */
import * as fixtures from "@/contracts/fixtures";
import type { EvidenceDoc, MatchEvidence, Person, TimeBlock } from "@/contracts/types";
import { addEvidence } from "./evidence";
import type { Candidate, SearchFilters, SearchService } from "./index";

const people = new Map<string, Person>(fixtures.people.map((p) => [p.id, p]));
const evidence = new Map<string, EvidenceDoc[]>();
const revisions = new Map<string, number>();
for (const e of fixtures.evidence) {
  evidence.set(e.personId, [...(evidence.get(e.personId) ?? []), e]);
}
const asks = new Map<string, { userId: string; text: string }>();
const resolved = new Set<string>();

const STOP = new Set(["i", "a", "an", "the", "to", "at", "in", "on", "of", "how", "want", "works", "work", "does", "do", "with", "and", "for", "is", "it", "my", "me", "get", "specifically", "what", "about"]);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function meetsHardFilters(person: Person, hard: SearchFilters["hard"] = {}): boolean {
  return (!hard.country || person.filters.country === hard.country)
    && (!hard.rorId || person.filters.rorId === hard.rorId)
    && (hard.hiring === undefined || person.filters.hiring === hard.hiring);
}

function overlaps(a: TimeBlock[], b: TimeBlock[]): boolean {
  return a.some((x) => b.some((y) => Date.parse(x.start) < Date.parse(y.end) && Date.parse(y.start) < Date.parse(x.end)));
}

export const memorySearch: SearchService = {
  async getPerson(id) {
    return getPerson(id);
  },

  async getPeople(ids) {
    return ids.flatMap((id) => getPerson(id) ?? []);
  },

  async ingestPerson(person, docs, revision) {
    const current = revisions.get(person.id);
    if (current !== undefined && (revision === undefined || revision < current)) return;
    people.set(person.id, person);
    if (docs !== undefined) evidence.set(person.id, docs);
    if (revision !== undefined) revisions.set(person.id, revision);
  },

  async searchCandidates(query, filters, limit = 10) {
    const q = new Set(tokens(query));
    const exclude = new Set(filters.excludeIds);
    const out: Candidate[] = [];
    for (const person of people.values()) {
      if (exclude.has(person.id) || !meetsHardFilters(person, filters.hard)) continue;
      const highlights: string[] = [];
      const found: MatchEvidence[] = [];
      let score = 0;
      for (const doc of evidence.get(person.id) ?? []) {
        const hit = tokens(`${doc.title} ${doc.text}`).filter((t) => q.has(t));
        if (hit.length) {
          score += new Set(hit).size;
          highlights.push(doc.title);
          addEvidence(found, doc);
        }
      }
      const bioHits = tokens(`${person.bio} ${person.organisations.join(" ")}`).filter((t) => q.has(t));
      score += new Set(bioHits).size * 0.5;
      if (score === 0) continue;
      if (filters.freeTimes && overlaps(filters.freeTimes, person.freeTimes)) score += 0.5;
      out.push({ person, highlights, evidence: found, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  },

  async registerAsk(askId, userId, askText) {
    if (!resolved.has(askId)) asks.set(askId, { userId, text: askText });
  },

  async removeAsk(askId) {
    resolved.add(askId);
    asks.delete(askId);
  },

  async whoIsLookingFor(person) {
    // fixtures.lookingFor[user] lists the people looking for someone like that user.
    const fromFixtures = fixtures.lookingFor[person.id] ?? [];
    const profile = new Set(tokens(`${person.bio} ${(evidence.get(person.id) ?? []).map((e) => e.title).join(" ")}`));
    const fromAsks = [...asks.values()]
      .filter(({ userId, text }) => userId !== person.id && tokens(text).some(w => profile.has(w)))
      .map(({ userId }) => userId);
    return [...new Set([...fromFixtures, ...fromAsks])];
  },

  async getAvailability(ids) {
    return Object.fromEntries(ids.map((id) => [id, people.get(id)?.freeTimes ?? []]));
  },
};

export function getPerson(id: string): Person | undefined {
  return people.get(id);
}
