/**
 * Rebuild recovery end to end: the real seedUsers, the real syncProfile and the real Elasticsearch
 * ingestion, with recorded Postgres rows (the Neon driver is the only database fake) and an in-memory
 * Elasticsearch that applies external_gte versions the way the cluster does.
 */
import { getTableColumns } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";

type Stored = { version: number; source: Record<string, unknown> };
const { query, store, down } = vi.hoisted(() => ({
  query: vi.fn(),
  store: { people: new Map<string, Stored>(), evidence: new Map<string, Stored>(), asks: new Map<string, Stored>() },
  down: new Set<string>(), // person IDs whose writes fail, as when the endpoint is unavailable
}));

vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
vi.mock("@elastic/elasticsearch", () => {
  class ResponseError extends Error {
    constructor(readonly statusCode: number) { super(`HTTP ${statusCode}`); }
  }
  type Index = keyof typeof store;
  type Target = { _index: Index; _id: string; version: number };
  type Operation = { index?: Target; delete?: Target } & Record<string, unknown>;
  type ByQuery = { bool: { filter: [{ term: { person_id: string } }, { range: { revision: { lte: number } } }]; must_not: [{ ids: { values: string[] } }] } };
  const personOf = (index: Index, id: string, source?: Record<string, unknown>) =>
    index === "people" ? id : String(source?.person_id ?? store[index].get(id)?.source.person_id);
  // external_gte: a write wins unless the stored version is newer.
  const write = (index: Index, id: string, version: number, source: Record<string, unknown>) => {
    if (down.has(personOf(index, id, source))) return 503;
    const current = store[index].get(id);
    if (current && current.version > version) return 409;
    store[index].set(id, { version, source });
    return 201;
  };
  const remove = (index: Index, id: string, version: number) => {
    const current = store[index].get(id);
    if (!current) return 404;
    if (down.has(personOf(index, id))) return 503;
    if (current.version > version) return 409;
    store[index].delete(id);
    return 200;
  };
  const fake = {
    async index({ index, id, version, document }: { index: Index; id: string; version: number; document: Record<string, unknown> }) {
      const status = write(index, id, version, document);
      if (status !== 201) throw new ResponseError(status);
      return {};
    },
    async bulk({ operations }: { operations: Operation[] }) {
      const items: Record<string, { status: number; error?: { reason: string } }>[] = [];
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        if (op.index) {
          const status = write(op.index._index, op.index._id, op.index.version, operations[++i]);
          items.push({ index: { status, ...(status === 503 ? { error: { reason: "unavailable" } } : {}) } });
        } else if (op.delete) {
          const status = remove(op.delete._index, op.delete._id, op.delete.version);
          items.push({ delete: { status, ...(status === 503 ? { error: { reason: "unavailable" } } : {}) } });
        }
      }
      return { errors: items.some((item) => Object.values(item)[0].status >= 300), items };
    },
    async deleteByQuery({ index, query: q }: { index: Index; query: ByQuery }) {
      const [{ term }, { range }] = q.bool.filter;
      const keep: string[] = q.bool.must_not[0].ids.values;
      if (down.has(term.person_id)) throw new ResponseError(503);
      for (const [id, doc] of store[index]) {
        if (doc.source.person_id === term.person_id && Number(doc.source.revision) <= range.revision.lte && !keep.includes(id)) store[index].delete(id);
      }
      return { timed_out: false, failures: [], version_conflicts: 0 };
    },
    async get({ index, id }: { index: Index; id: string }) {
      const doc = store[index].get(id);
      if (!doc) throw new ResponseError(404);
      return { _source: doc.source };
    },
  };
  return { Client: class { constructor() { return fake; } }, errors: { ResponseError } };
});

import { users } from "../db/schema";
import { seedUsers } from "./seed";

const columns = Object.keys(getTableColumns(users)) as (keyof typeof users.$inferSelect)[];
const json = new Set(["languages", "organisations", "filters", "freeTimes", "visibility", "githubEvidence", "profileEvidence", "profileSources", "expertise"]);
/** One users row as the Neon driver returns it: an array in column order, JSON columns as text. */
function row(user: Record<string, unknown>): unknown[] {
  return columns.map((name) => {
    const value = user[name] ?? null;
    return json.has(name) && value !== null ? JSON.stringify(value) : value;
  });
}

const base = people[0];
const at = "2026-11-07T12:00:00.000Z";
function user(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, githubLogin: `${id}-gh`, name: base.name, bio: base.bio, languages: base.languages, organisations: base.organisations,
    filters: base.filters, freeTimes: [], createdAt: "2026-11-05T00:00:00Z", revision: 5, workplaceName: null,
    badgeColour: "sunflower", visibility: { country: true, workplace: true, hiring: true },
    githubEvidence: [], githubEvidencePending: false, avatar: null,
    profileEvidence: null, profileSources: [], profileEvidencePending: false, expertise: null, textVersion: 0,
    ...extra,
  };
}
const approved = (owner: string, source: string, kind: string, name: string, url?: string) => ({
  id: `${owner}:${kind}:${name}`, personId: owner, sourceId: `${owner}:${source}`, source, kind,
  title: `${kind} ${name}`, excerpt: `Approved ${source} excerpt about ${name}.`, retrievedAt: at, ...(url ? { url } : {}),
});
const sourceRecord = (owner: string, source: string, count = 1) =>
  ({ id: `${owner}:${source}`, source, label: source, evidenceCount: count, approvedAt: at });
const legacyRepo = (owner: string, name: string) =>
  ({ id: `${owner}:repo:${name}`, personId: owner, kind: "repo", title: name, text: `Repository ${name}.`, url: `https://github.com/x/${name}` });

/** The recorded result for seedUsers' one select; later statements (pending acknowledgements) return nothing. */
function database(...rows: Record<string, unknown>[]) {
  query.mockReset().mockResolvedValueOnce({ rows: rows.map(row) }).mockResolvedValue({ rows: [] });
}
const statements = () => query.mock.calls.map(([sql, params]) => ({ sql: String(sql), params: params as unknown[] }));
const evidenceOf = (id: string) => [...store.evidence].filter(([, doc]) => doc.source.person_id === id);
const indexedPerson = (id: string) => store.people.get(id)?.source.person as Record<string, unknown> | undefined;

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubEnv("ELASTICSEARCH_URL", "https://es.example.invalid");
  vi.stubEnv("ELASTICSEARCH_API_KEY", "test-key");
});
beforeEach(() => {
  for (const index of Object.values(store)) index.clear(); // a freshly rebuilt, empty cluster
  down.clear();
});

describe("recovering signed-up users after a rebuild", () => {
  it("restores approved evidence from all four sources, expertise and the saved revision", async () => {
    const owner = "u_all";
    const evidence = [
      approved(owner, "github", "repo", "sched", "https://github.com/x/sched"),
      approved(owner, "research", "paper", "W42", "https://openalex.org/W42"),
      approved(owner, "public_profile", "profile_page", "public-page", "https://example.org/ada"),
      approved(owner, "cv", "cv", "excerpt-1"),
    ];
    database(user(owner, {
      revision: 12, expertise: ["Scheduling", "Climate models"], profileEvidence: evidence, profileEvidencePending: true,
      profileSources: ["github", "research", "public_profile", "cv"].map((source) => sourceRecord(owner, source)),
    }));

    await expect(seedUsers()).resolves.toEqual({ indexed: 1, failed: [] });

    expect(store.people.get(owner)).toMatchObject({ version: 12, source: { revision: 12 } });
    expect(indexedPerson(owner)).toMatchObject({ expertise: ["Scheduling", "Climate models"] });
    expect(store.people.get(owner)?.source.profile).toContain("Climate models");
    const docs = new Map(evidenceOf(owner));
    expect([...docs.keys()].sort()).toEqual([...evidence.map((e) => e.id), `${owner}:profile`].sort());
    for (const e of evidence) expect(docs.get(e.id)).toMatchObject({ version: 12, source: { kind: e.kind, revision: 12, content: expect.stringContaining(e.excerpt) } });
    expect(docs.get(`${owner}:cv:excerpt-1`)?.source.url).toBeUndefined(); // CV excerpts have no link
    // The pending flag is acknowledged only for the revision just indexed.
    const acknowledge = statements().find((s) => s.sql.startsWith("update"));
    expect(acknowledge?.sql).toMatch(/"profile_evidence_pending" = \$1 where \("users"\."id" = \$2 and "users"\."revision" = \$3\)/);
    expect(acknowledge?.params).toEqual([false, owner, 12]);
  });

  it("keeps a Google-only person's GitHub handle null", async () => {
    database(user("u_google_only", { githubLogin: null, profileEvidence: [], profileSources: [] }));
    await seedUsers();
    expect(indexedPerson("u_google_only")).toMatchObject({ githubLogin: null });
  });

  it("uses legacy GitHub evidence when there is no general snapshot yet", async () => {
    database(user("u_legacy", { githubEvidence: [legacyRepo("u_legacy", "durable")], githubEvidencePending: true }));
    await seedUsers();
    expect(evidenceOf("u_legacy").map(([id]) => id).sort()).toEqual(["u_legacy:profile", "u_legacy:repo:durable"]);
    expect(statements().find((s) => s.sql.startsWith("update"))?.sql).toContain('"github_evidence_pending" = $1');
  });

  it("never restores withdrawn evidence from an explicit empty snapshot, even when the index still had it", async () => {
    const owner = "u_withdrawn";
    // The legacy column still holds the repo the person withdrew; the empty snapshot is authoritative.
    database(user(owner, { revision: 8, githubEvidence: [legacyRepo(owner, "withdrawn")], profileEvidence: [],
      profileSources: [{ ...sourceRecord(owner, "github", 0), removed: true }] }));
    // Reseeding without dropping the index: the repo is still there from an older save.
    store.evidence.set(`${owner}:repo:withdrawn`, { version: 3, source: { person_id: owner, revision: 3, kind: "repo" } });

    await seedUsers();

    expect(evidenceOf(owner).map(([id]) => id)).toEqual([`${owner}:profile`]);
  });

  it("reads only the public users row: private inputs and unapproved excerpts never reach search", async () => {
    const owner = "u_private";
    const kept = approved(owner, "cv", "cv", "approved");
    database(user(owner, { profileEvidence: [kept], profileSources: [sourceRecord(owner, "cv")] }));

    await seedUsers();

    // One select, from users only, for finished onboarding; the private staging table is never read.
    const reads = statements().filter((s) => s.sql.startsWith("select"));
    expect(reads).toHaveLength(1);
    expect(reads[0].sql).toMatch(/from "users" where "users"\."filters" is not null/);
    expect(statements().every((s) => !s.sql.includes("profile_enrichment_states"))).toBe(true);
    // Only the approved excerpt (plus the generated profile document) is indexed.
    expect(evidenceOf(owner).map(([id]) => id).sort()).toEqual([kept.id, `${owner}:profile`]);
  });

  it("keeps saved evidence and pending status when indexing fails, and still recovers everyone else", async () => {
    const failing = user("u_down", { revision: 9, profileEvidence: [approved("u_down", "research", "paper", "W7", "https://openalex.org/W7")],
      profileSources: [sourceRecord("u_down", "research")], profileEvidencePending: true });
    database(failing, user("u_ok", { githubLogin: null }));
    down.add("u_down");

    const result = await seedUsers();

    expect(result.indexed).toBe(1);
    expect(result.failed).toEqual(["u_down"]);
    expect(store.people.has("u_ok")).toBe(true);
    // Nothing is written to Postgres for the failed user: its evidence stays saved and its pending flag stays set.
    const writes = statements().filter((s) => !s.sql.startsWith("select"));
    expect(writes.every((s) => !s.params.includes("u_down"))).toBe(true);
    expect(writes.every((s) => !/profile_evidence"|github_evidence"|"bio"|"expertise"/.test(s.sql))).toBe(true);
  });

  it("never lets an older saved revision overwrite newer indexed data", async () => {
    const owner = "u_raced";
    // A live save at revision 6 reached the index after the seed read revision 5 from Postgres.
    store.people.set(owner, { version: 6, source: { person: { id: owner }, revision: 6, evidence_ids: [`${owner}:paper:new`] } });
    store.evidence.set(`${owner}:paper:new`, { version: 6, source: { person_id: owner, revision: 6, kind: "paper" } });
    database(user(owner, { revision: 5, profileEvidence: [approved(owner, "research", "paper", "old", "https://openalex.org/old")],
      profileSources: [sourceRecord(owner, "research")] }));

    // Not a failure: the newer save already in the index is the one to keep.
    await expect(seedUsers()).resolves.toEqual({ indexed: 1, failed: [] });

    expect(store.people.get(owner)).toMatchObject({ version: 6, source: { revision: 6 } });
    expect(evidenceOf(owner).map(([id]) => id)).toEqual([`${owner}:paper:new`]);
  });

  it("skips a corrupt approved snapshot without reviving legacy evidence or losing valid users", async () => {
    database(user("u_bad", { profileEvidence: { corrupt: true }, profileEvidencePending: true,
      githubEvidence: [legacyRepo("u_bad", "must-not-return")] }), user("u_good", { githubLogin: null }));
    expect(await seedUsers()).toEqual({ indexed: 1, failed: ["u_bad"] });
    expect(store.people.has("u_good")).toBe(true);
    expect(evidenceOf("u_bad")).toEqual([]);
    expect(statements().filter(s => s.sql.startsWith("update")).every(s => !s.params.includes("u_bad"))).toBe(true);
  });
});
