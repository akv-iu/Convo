/**
 * Elasticsearch search (B1).
 * - `evidence`: one document per piece of evidence plus one "profile" document per
 *   person (bio, organisations, languages). Each carries its owner's hard filters
 *   and free times, so one hybrid query can filter, boost and collapse by person.
 * - `people`: the full Person (lookups, availability) and the text asks are matched against.
 * - `asks`: each open ask stored as a percolator query (reverse search).
 * Every write of a person carries its Postgres revision as an external version, so
 * an older save can never overwrite a newer one.
 */
import { Client, errors, type estypes } from "@elastic/elasticsearch";
import { Person, type EvidenceDoc, type TimeBlock } from "@/contracts/types";
import type { Candidate, SearchFilters, SearchService } from "./index";

export const INDEX = { people: "people", evidence: "evidence", asks: "asks" } as const;
const RERANKER = ".jina-reranker-v3.5";
// ponytail: calibration knobs, set by hand. Tune with real asks and profiles (try-search --samples).
const WINDOW = 50; // results fused by RRF and re-read by the reranker
const SEMANTIC_MIN_SCORE = 4; // measured on ELSER: related evidence scores 4 to 8, relevant 14+, noise under 3
const FREE_TIME_BOOST = 0.5;
const ASK_MIN_MATCH = "2<60%"; // share of an ask's key terms a profile must contain

let cached: Client | undefined;

/** Lazily created so the fake API, builds and tests never need Elasticsearch. */
export function client(): Client {
  if (cached) return cached;
  const node = process.env.ELASTICSEARCH_URL;
  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  if (!node || !apiKey) throw new Error("ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY are not set.");
  cached = new Client({ node, auth: { apiKey } });
  return cached;
}

type Kind = EvidenceDoc["kind"] | "profile";
interface IndexedDoc { id: string; kind: Kind; title: string; text: string; url?: string }
interface EvidenceSource { person_id: string; kind: Kind; title: string; text: string; url?: string }

const hasStatus = (error: unknown, status: number) => error instanceof errors.ResponseError && error.statusCode === status;

function parsePerson(value: unknown): Person | undefined {
  const parsed = Person.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Bio, organisations and languages; empty when the person has none of them. */
function profileText(person: Person): string {
  return [person.bio.trim(), person.organisations.join(", "), person.languages.join(", ")].filter(Boolean).join(" · ");
}

/** What asks are matched against: the profile plus every piece of evidence. */
function matchText(person: Person, evidence: EvidenceDoc[]): string {
  return [profileText(person), ...evidence.map((e) => `${e.title}. ${e.text}`)].join("\n");
}

function evidenceSource(person: Person, doc: IndexedDoc, revision: number) {
  return {
    person_id: person.id, kind: doc.kind, title: doc.title, text: doc.text, url: doc.url,
    content: `${doc.title}. ${doc.text}`,
    country: person.filters.country, ror_id: person.filters.rorId ?? undefined, hiring: person.filters.hiring,
    synthetic: person.synthetic,
    free_times: person.freeTimes.map((t) => ({ gte: t.start, lt: t.end })),
    revision,
  };
}

async function storedEvidence(es: Client, personId: string): Promise<EvidenceDoc[]> {
  const result = await es.search<EvidenceSource>({
    // ponytail: profiles carry at most 20 repos plus a few talks; page this if a person ever passes 100.
    index: INDEX.evidence, size: 100, _source: ["kind", "title", "text", "url"], allow_partial_search_results: false,
    query: { bool: { filter: [{ term: { person_id: personId } }], must_not: [{ term: { kind: "profile" } }] } },
  });
  return result.hits.hits.flatMap((hit) => {
    const doc = hit._source;
    if (!hit._id || !doc || doc.kind === "profile") return [];
    return [{ id: hit._id, personId, kind: doc.kind, title: doc.title, text: doc.text, ...(doc.url ? { url: doc.url } : {}) }];
  });
}

/** People by ID in one call. A failed lookup throws: it must not look like "no such person". */
async function fetchPeople(es: Client, ids: string[]): Promise<Map<string, Person>> {
  const { docs } = await es.mget<{ person: unknown }>({ index: INDEX.people, ids, _source_includes: ["person"] });
  const people = new Map<string, Person>();
  for (const doc of docs) {
    if ("error" in doc) throw new Error(`Looking up ${doc._id} failed: ${doc.error.reason ?? doc.error.type}`);
    const person = doc.found ? parsePerson(doc._source?.person) : undefined;
    if (person) people.set(person.id, person);
  }
  return people;
}

const failedOp = (items: estypes.BulkResponseItem[]) =>
  // 409: a newer save already wrote or removed this document. 404: the document to delete was never there.
  items.find((op) => op.status >= 300 && op.status !== 409 && op.status !== 404);

/** After a save replaces the evidence list: remove this person's documents from older saves. */
async function removeOlderEvidence(es: Client, personId: string, version: number): Promise<void> {
  for (const attempt of [1, 2]) {
    const result = await es.deleteByQuery({
      index: INDEX.evidence, conflicts: "proceed", refresh: true,
      query: { bool: { filter: [{ term: { person_id: personId } }, { range: { revision: { lt: version } } }] } },
    });
    if (result.timed_out || result.failures?.length) throw new Error("Removing replaced evidence failed. Retry the same save.");
    if (!result.version_conflicts) return;
    // A document changed mid-cleanup: run once more over what is now visible.
    if (attempt === 2) throw new Error("Removing replaced evidence kept conflicting with another save. Retry the same save.");
  }
}

/**
 * If a newer save landed while this one was writing, take back what only this
 * older save wrote, so it can't restore evidence the newer save removed.
 */
async function settleIfSuperseded(es: Client, personId: string, version: number, written: string[]): Promise<void> {
  let latest: { revision: number; evidence_ids?: string[] } | undefined;
  try {
    latest = (await es.get<{ revision: number; evidence_ids?: string[] }>({
      index: INDEX.people, id: personId, _source_includes: ["revision", "evidence_ids"],
    }))._source;
  } catch (error) {
    if (hasStatus(error, 404)) return; // the index was rebuilt meanwhile: nothing to settle
    throw error;
  }
  if (!latest || latest.revision <= version) return;
  const keep = new Set(latest.evidence_ids ?? []);
  const stale = written.filter((id) => !keep.has(id));
  if (!stale.length) return;
  const result = await es.bulk({
    refresh: "wait_for",
    operations: stale.map((id) => ({ delete: { _index: INDEX.evidence, _id: id, version, version_type: "external_gte" as const } })),
  });
  const failed = failedOp(result.items.flatMap((item) => item.delete ?? []));
  if (failed) throw new Error(`Removing superseded evidence failed: ${failed.error?.reason ?? "unknown error"}`);
}

async function indexedMatchText(es: Client, personId: string): Promise<string | undefined> {
  try {
    const doc = await es.get<{ profile?: string }>({ index: INDEX.people, id: personId, _source_includes: ["profile"] });
    return doc._source?.profile;
  } catch (error) {
    if (hasStatus(error, 404)) return undefined;
    throw error;
  }
}

function searchFilter(filters: SearchFilters): estypes.QueryDslQueryContainer[] {
  const out: estypes.QueryDslQueryContainer[] = [];
  if (filters.excludeIds.length) out.push({ bool: { must_not: [{ terms: { person_id: filters.excludeIds } }] } });
  const hard = filters.hard ?? {};
  if (hard.country) out.push({ term: { country: hard.country } });
  if (hard.rorId) out.push({ term: { ror_id: hard.rorId } });
  if (hard.hiring !== undefined) out.push({ term: { hiring: hard.hiring } });
  return out;
}

function freeTimeBoost(times: TimeBlock[] = []): estypes.QueryDslQueryContainer[] {
  return times.map((t) => ({ range: { free_times: { gte: t.start, lt: t.end, relation: "intersects", boost: FREE_TIME_BOOST } } }));
}

/** Keyword and semantic search, each collapsed to one hit per person, fused with RRF. */
function hybrid(query: string, filters: SearchFilters): estypes.RetrieverContainer {
  const should = freeTimeBoost(filters.freeTimes);
  const collapse = { field: "person_id" };
  return {
    rrf: {
      retrievers: [
        { standard: { query: { bool: { must: [{ multi_match: { query, fields: ["title^2", "text"] } }], should } }, collapse } },
        // Semantic search always returns its nearest documents, however distant: keep only real matches.
        { standard: { query: { bool: { must: [{ semantic: { field: "content", query } }], should } }, collapse, min_score: SEMANTIC_MIN_SCORE } },
      ],
      rank_window_size: WINDOW,
      filter: searchFilter(filters),
    },
  };
}

function highlightLine(hit: estypes.SearchHit<EvidenceSource>): string | undefined {
  const doc = hit._source;
  if (!doc) return undefined;
  const snippet = hit.highlight?.text?.[0]?.replace(/<\/?em>/g, "");
  if (doc.kind === "profile") return snippet ?? (doc.text.length > 160 ? `${doc.text.slice(0, 157)}...` : doc.text);
  return snippet ? `${doc.title}: ${snippet}` : doc.title;
}

/** Group the ranked hits by person (best first), attach up to three evidence lines, score 0 to 5. */
async function toCandidates(es: Client, hits: estypes.SearchHit<EvidenceSource>[], limit: number): Promise<Candidate[]> {
  const byPerson = new Map<string, { score: number; highlights: string[] }>();
  for (const hit of hits) {
    const personId = hit._source?.person_id;
    if (!personId) continue;
    let entry = byPerson.get(personId);
    if (!entry) {
      if (byPerson.size >= limit) continue;
      entry = { score: hit._score ?? 0, highlights: [] };
      byPerson.set(personId, entry);
    }
    const line = highlightLine(hit);
    if (line && entry.highlights.length < 3 && !entry.highlights.includes(line)) entry.highlights.push(line);
  }
  if (!byPerson.size) return [];
  const people = await fetchPeople(es, [...byPerson.keys()]);
  const top = Math.max(...[...byPerson.values()].map((e) => e.score), Number.EPSILON);
  return [...byPerson.entries()].flatMap(([id, entry]) => {
    const person = people.get(id);
    return person ? [{ person, highlights: entry.highlights, score: Math.round((5000 * entry.score) / top) / 1000 }] : [];
  });
}

/** An open ask as a percolator document; shared by registerAsk and the seed script's bulk load. */
export function askDocument(askId: string, userId: string, askText: string) {
  return { ask_id: askId, user_id: userId, active: true, query: { match: { profile: { query: askText, minimum_should_match: ASK_MIN_MATCH } } } };
}

export const elasticSearch: SearchService = {
  async getPerson(id) {
    try {
      const doc = await client().get<{ person: unknown }>({ index: INDEX.people, id, _source_includes: ["person"] });
      return parsePerson(doc._source?.person);
    } catch (error) {
      if (hasStatus(error, 404)) return undefined;
      throw error;
    }
  },

  async ingestPerson(person, evidence, revision) {
    const es = client();
    const version = revision ?? 0;
    const docs = evidence ?? await storedEvidence(es, person.id);
    // A profile that is only a name is no evidence of anything, so it gets no document.
    const profileId = `${person.id}:profile`;
    const profile = profileText(person);
    const indexed: IndexedDoc[] = [
      ...docs.map(({ id, kind, title, text, url }) => ({ id, kind, title, text, url })),
      ...(profile ? [{ id: profileId, kind: "profile" as const, title: person.name, text: profile }] : []),
    ];
    const ids = indexed.map((doc) => doc.id);
    try {
      await es.index({
        index: INDEX.people, id: person.id, version, version_type: "external_gte",
        document: { person, profile: matchText(person, docs), evidence_ids: ids, revision: version },
      });
    } catch (error) {
      if (hasStatus(error, 409)) return; // a newer revision is already indexed
      throw error;
    }
    const at = { version, version_type: "external_gte" as const };
    // Resolve only once the change is searchable: callers treat success as "search is in sync".
    const result = await es.bulk({
      refresh: "wait_for",
      operations: [
        ...indexed.flatMap((doc) => [{ index: { _index: INDEX.evidence, _id: doc.id, ...at } }, evidenceSource(person, doc, version)]),
        ...(profile ? [] : [{ delete: { _index: INDEX.evidence, _id: profileId, ...at } }]),
      ],
    });
    const failed = failedOp(result.items.flatMap((item) => item.index ?? item.delete ?? []));
    if (failed) throw new Error(`Evidence indexing failed: ${failed.error?.reason ?? "unknown error"}`);
    if (evidence) await removeOlderEvidence(es, person.id, version); // a new list replaces the old one
    await settleIfSuperseded(es, person.id, version, ids);
  },

  async searchCandidates(query, filters, limit = 10) {
    const es = client();
    const request = (retriever: estypes.RetrieverContainer) => es.search<EvidenceSource>({
      index: INDEX.evidence, size: WINDOW, retriever, _source: ["person_id", "kind", "title", "text"], allow_partial_search_results: false,
      highlight: {
        highlight_query: { multi_match: { query, fields: ["title", "text"] } },
        fields: { text: { number_of_fragments: 1, fragment_size: 160 } },
      },
    });
    let result: estypes.SearchResponse<EvidenceSource>;
    try {
      result = await request({
        text_similarity_reranker: { retriever: hybrid(query, filters), field: "content", inference_text: query, inference_id: RERANKER, rank_window_size: WINDOW },
      });
    } catch (error) {
      // Reranking only refines the order; if the hosted reranker fails, serve the hybrid ranking.
      console.warn(`Reranker unavailable, serving hybrid ranking: ${error instanceof Error ? error.message : String(error)}`);
      result = await request(hybrid(query, filters));
    }
    return toCandidates(es, result.hits.hits, limit);
  },

  async registerAsk(askId, userId, askText) {
    try {
      await client().index({ index: INDEX.asks, id: askId, op_type: "create", refresh: "wait_for", document: askDocument(askId, userId, askText) });
    } catch (error) {
      if (!hasStatus(error, 409)) throw error; // already registered, or resolved: never revive it
    }
  },

  async removeAsk(askId) {
    // A tombstone, not a delete: a late registerAsk for this ID then conflicts instead of reviving it.
    await client().index({ index: INDEX.asks, id: askId, refresh: "wait_for", document: { ask_id: askId, active: false, query: { match_none: {} } } });
  },

  async whoIsLookingFor(person) {
    const es = client();
    const profile = await indexedMatchText(es, person.id) ?? matchText(person, []);
    const result = await es.search({
      index: INDEX.asks, size: 0, allow_partial_search_results: false,
      query: { bool: {
        filter: [{ percolate: { field: "query", document: { profile } } }, { term: { active: true } }],
        must_not: [{ term: { user_id: person.id } }],
      } },
      // ponytail: at most 1000 distinct askers per person; page the aggregation if a conference ever exceeds it.
      aggs: { askers: { terms: { field: "user_id", size: 1000 } } },
    });
    const askers = result.aggregations?.askers as estypes.AggregationsStringTermsAggregate | undefined;
    const buckets = Array.isArray(askers?.buckets) ? askers.buckets : [];
    return buckets.map((bucket) => String(bucket.key));
  },

  async getAvailability(ids) {
    if (!ids.length) return {};
    const people = await fetchPeople(client(), ids);
    return Object.fromEntries(ids.map((id) => [id, people.get(id)?.freeTimes ?? []]));
  },
};
