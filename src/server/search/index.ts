/**
 * Search interface (B1). The real version talks to Elasticsearch; the
 * in-memory version is used by the fake API and when FAKES includes "search".
 */
import { config } from "@/server/config";
import type { EvidenceDoc, HardFilters, Person, TimeBlock } from "@/contracts/types";
import { elasticSearch } from "./elastic";
import { memorySearch } from "./memory";

export interface Candidate {
  person: Person;
  highlights: string[];
  /** Higher is better. Elasticsearch scales it to 0 to 5; the pipeline adds 1 for mutual interest. */
  score: number;
}

export interface SearchFilters {
  /** People to leave out: the requester, rejected people, and so on. */
  excludeIds: string[];
  /** Boost people whose free times overlap these. */
  freeTimes?: TimeBlock[];
  /** Hard filters: only people matching every given value. No screen sends these yet. */
  hard?: Partial<HardFilters>;
}

export interface SearchService {
  /** Look up a recipient, including synthetic profiles; undefined means not found. */
  getPerson(id: string): Promise<Person | undefined>;
  /**
   * Omit evidence to preserve it, or pass a list to replace it.
   * Atomically ignore older revisions (and unversioned writes after versioned ones).
   * Equal revisions may retry. Unversioned writes are for fixtures before a real save.
   */
  ingestPerson(person: Person, evidence?: EvidenceDoc[], revision?: number): Promise<void>;
  /** Hybrid search over evidence, collapsed to one result per person, with highlights. */
  searchCandidates(query: string, filters: SearchFilters, limit?: number): Promise<Candidate[]>;
  /** Register once by ID. A resolved ID must never be reactivated by a delayed registration. */
  registerAsk(askId: string, userId: string, askText: string): Promise<void>;
  /** Idempotently remove this ask, preserving the owner's other asks. */
  removeAsk(askId: string): Promise<void>;
  /** Which users have an ask this person could answer (reverse search). */
  whoIsLookingFor(person: Person): Promise<string[]>;
  /** Free times for several people. */
  getAvailability(personIds: string[]): Promise<Record<string, TimeBlock[]>>;
}

export const search: SearchService = config.fakeSearch || config.fakeApi ? memorySearch : elasticSearch;
