/**
 * Search interface (B1). The real version talks to Elasticsearch; the
 * in-memory version is used by the fake API and when FAKES includes "search".
 */
import { config } from "@/server/config";
import type { EvidenceDoc, Person, TimeBlock } from "@/contracts/types";
import { memorySearch } from "./memory";

export interface Candidate {
  person: Person;
  highlights: string[];
  score: number;
}

export interface SearchFilters {
  /** People to leave out: the requester, rejected people, and so on. */
  excludeIds: string[];
  /** Boost people whose free times overlap these. */
  freeTimes?: TimeBlock[];
}

export interface SearchService {
  /** Write a person; omit evidence to preserve it, or pass a list to replace it. */
  ingestPerson(person: Person, evidence?: EvidenceDoc[]): Promise<void>;
  /** Hybrid search over evidence, collapsed to one result per person, with highlights. */
  searchCandidates(query: string, filters: SearchFilters, limit?: number): Promise<Candidate[]>;
  /** Store a user's ask as a percolator query. */
  registerAsk(userId: string, askText: string): Promise<void>;
  /** Which users have an ask this person could answer (reverse search). */
  whoIsLookingFor(person: Person): Promise<string[]>;
  /** Free times for several people. */
  getAvailability(personIds: string[]): Promise<Record<string, TimeBlock[]>>;
}

function notImplemented(): never {
  throw new Error("Elasticsearch search is not implemented yet (B1). Set FAKES=search to use the in-memory version.");
}

export const elasticSearch: SearchService = {
  ingestPerson: async () => notImplemented(),
  searchCandidates: async () => notImplemented(),
  registerAsk: async () => notImplemented(),
  whoIsLookingFor: async () => notImplemented(),
  getAvailability: async () => notImplemented(),
};

export const search: SearchService = config.fakeSearch || config.fakeApi ? memorySearch : elasticSearch;
