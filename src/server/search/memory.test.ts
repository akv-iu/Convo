import { describe, expect, it, vi } from "vitest";
import { DEMO_USER_A, DEMO_USER_B, people } from "@/contracts/fixtures";
import { EvidenceKind, type EvidenceDoc } from "@/contracts/types";
import { memorySearch } from "./memory";

const byId = (id: string) => {
  const person = people.find((p) => p.id === id);
  if (!person) throw new Error(`no fixture ${id}`);
  return person;
};

// The enrichment contract adds the profile_page and cv kinds; until it's on main the type doesn't list them.
const kind = (name: string) => name as EvidenceDoc["kind"];
// A match lists only the kinds the contract knows, so expectations follow it before and after that merge.
const listed = (name: string) => (EvidenceKind.options as readonly string[]).includes(name);
const matchedIds = async (query: string) => (await memorySearch.searchCandidates(query, { excludeIds: [] })).map((c) => c.person.id);

describe("one index for every route", () => {
  it("shares people, evidence and asks with a separately bundled copy of this module", async () => {
    vi.resetModules();
    const other = (await import("./memory")).memorySearch;
    expect(other).not.toBe(memorySearch); // a second module instance, as another route's bundle gets
    const person = { ...structuredClone(people[0]), id: "shared-index-test", bio: "" };
    await other.ingestPerson(person, [{ id: "shared-index-test:repo:x", personId: person.id, kind: "repo", title: "SharedIndexToken", text: "" }], 1);
    expect(await memorySearch.getPerson(person.id)).toEqual(person);
    expect(await matchedIds("SharedIndexToken")).toEqual([person.id]);
    await other.registerAsk("shared-index-ask", "shared-index-asker", "SharedIndexToken");
    expect(await memorySearch.whoIsLookingFor(person)).toContain("shared-index-asker");
  });
});

describe("approved expertise", () => {
  it("is matched and read by reverse search, and a stale save can't bring it back once withdrawn", async () => {
    const researcher = { ...structuredClone(people[0]), id: "expertise-test", bio: "", organisations: [], expertise: ["Qubit calibration"] };
    await memorySearch.ingestPerson(researcher, [], 1);
    expect(await matchedIds("qubit calibration")).toContain(researcher.id);
    await memorySearch.registerAsk("expertise-ask", "expertise-asker", "qubit calibration");
    expect(await memorySearch.whoIsLookingFor(researcher)).toContain("expertise-asker");

    const withdrawn = { ...researcher, expertise: [] };
    await memorySearch.ingestPerson(withdrawn, [], 2);
    await memorySearch.ingestPerson(researcher, [], 1); // the older save, arriving late
    expect(await matchedIds("qubit calibration")).not.toContain(researcher.id);
  });
});

describe("approved evidence from every source", () => {
  it("matches papers, profile pages, pasted profile text and CV excerpts, and a withdrawn CV stays withdrawn", async () => {
    const person = { ...structuredClone(people[0]), id: "sources-test", bio: "" };
    const doc = (k: string, external: string, title: string, text: string, url?: string): EvidenceDoc =>
      ({ id: `${person.id}:${k}:${external}`, personId: person.id, kind: kind(k), title, text, ...(url ? { url } : {}) });
    const paper = doc("paper", "W1", "Calibrating qubits", "PaperSourceToken", "https://openalex.org/W1");
    const page = doc("profile_page", "page", "Ada at Example University", "PageSourceToken", "https://example.edu/people/ada");
    const pasted = doc("profile_page", "text", "Profile text", "PastedSourceToken"); // pasted text has no link
    const cv = doc("cv", "upload-1", "Postdoctoral researcher", "CvSourceToken"); // nor does a CV
    await memorySearch.ingestPerson(person, [paper, page, pasted, cv], 2);
    const hit = (await memorySearch.searchCandidates("PaperSourceToken PageSourceToken PastedSourceToken CvSourceToken", { excludeIds: [] }))
      .find((c) => c.person.id === person.id);
    expect(hit?.evidence).toEqual([paper, page, pasted, cv].filter((d) => listed(d.kind))
      .map(({ kind: k, title, url }) => (url ? { kind: k, title, url } : { kind: k, title })));

    await memorySearch.ingestPerson(person, [paper, page, pasted], 3); // the CV is withdrawn
    await memorySearch.ingestPerson(person, [paper, page, pasted, cv], 2); // the older save, retried late
    expect(await matchedIds("CvSourceToken")).not.toContain(person.id);
    expect(await matchedIds("PastedSourceToken")).toContain(person.id);
  });
});

describe("evidence IDs", () => {
  it("refuses evidence that isn't this person's, takes the generated profile's ID or, in a real save, lacks its namespace", async () => {
    const person = { ...structuredClone(people[0]), id: "namespace-test", bio: "" };
    const good: EvidenceDoc = { id: "namespace-test:repo:ok", personId: person.id, kind: "repo", title: "NamespaceToken", text: "" };
    const refused: [EvidenceDoc, number | undefined][] = [
      [{ ...good, personId: "someone-else" }, 1],
      [{ ...good, id: "namespace-test:profile" }, undefined], // reserved, even for fixtures
      [{ ...good, id: "ok" }, 1], // real saves name the owner, kind and source ID
      [{ ...good, id: "someone-else:repo:ok" }, 1],
      [{ ...good, id: "namespace-test:paper:ok" }, 1], // the wrong kind
      [{ ...good, id: "namespace-test:repo:" }, 1], // no source ID
    ];
    for (const [doc, revision] of refused) {
      await expect(memorySearch.ingestPerson(person, [good, doc], revision)).rejects.toThrow(/^Evidence /);
    }
    expect(await memorySearch.getPerson(person.id)).toBeUndefined(); // nothing was written

    await memorySearch.ingestPerson(person, [{ ...good, id: "fixture-style-id" }]); // fixtures and synthetic people predate namespaces
    await memorySearch.ingestPerson(person, [good], 1);
    expect(await matchedIds("NamespaceToken")).toEqual([person.id]);
  });
});

describe("fixture mutual interest", () => {
  it("lists the people looking for someone like the given user, not the people that user wants", async () => {
    expect(await memorySearch.whoIsLookingFor(byId(DEMO_USER_A))).toEqual(expect.arrayContaining([DEMO_USER_B, "p_006"]));
    expect(await memorySearch.whoIsLookingFor(byId(DEMO_USER_B))).toEqual(["p_006"]);
  });
});

describe("hard filters", () => {
  it("keeps only people matching every given filter", async () => {
    const { country, hiring } = byId(DEMO_USER_B).filters;
    const all = await memorySearch.searchCandidates("kubernetes scheduler preemption etcd raft", { excludeIds: [] });
    const filtered = await memorySearch.searchCandidates("kubernetes scheduler preemption etcd raft", { excludeIds: [], hard: { country, hiring } });
    expect(filtered.map((c) => c.person.id)).toContain(DEMO_USER_B);
    expect(filtered.every((c) => c.person.filters.country === country && c.person.filters.hiring === hiring)).toBe(true);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
  });
});

describe("evidence behind a candidate", () => {
  it("lists the matching evidence in order, with https links", async () => {
    const found = await memorySearch.searchCandidates("kubernetes scheduler preemption", { excludeIds: [] });
    const b = found.find((c) => c.person.id === DEMO_USER_B);
    expect(b?.evidence[0]).toEqual({
      kind: "commit_area",
      title: "Maintains pkg/scheduler/framework/preemption",
      url: "https://github.com/kubernetes/kubernetes/tree/master/pkg/scheduler/framework/preemption",
    });
    expect(b?.evidence.map((e) => e.kind)).toContain("talk"); // a document without a link keeps its title
    expect(found.every((c) => c.evidence.length <= 5)).toBe(true);
  });

  it("drops a non-https link but keeps the item", async () => {
    const person = { ...structuredClone(people[0]), id: "evidence-link-test", bio: "" };
    await memorySearch.ingestPerson(person, [
      { id: "plain-link", personId: person.id, kind: "repo", title: "LinkToken repo", text: "", url: "http://example.org/repo" },
    ]);
    const [candidate] = (await memorySearch.searchCandidates("LinkToken", { excludeIds: [] })).filter((c) => c.person.id === person.id);
    expect(candidate.evidence).toEqual([{ kind: "repo", title: "LinkToken repo" }]);
    await memorySearch.ingestPerson(person, []);
  });
});

describe("ask lifecycle", () => {
  it("counts a person once, removes only the resolved ask, and ignores late registration", async () => {
    const target = { ...people[0], id: "lifecycle-target", bio: "LifecycleUniqueTopic" };
    await memorySearch.registerAsk("lifecycle-one", "lifecycle-owner", target.bio);
    await memorySearch.registerAsk("lifecycle-two", "lifecycle-owner", target.bio);
    await memorySearch.registerAsk("lifecycle-two", "lifecycle-owner", target.bio);
    expect(await memorySearch.whoIsLookingFor(target)).toEqual(["lifecycle-owner"]);
    await memorySearch.removeAsk("lifecycle-one");
    expect(await memorySearch.whoIsLookingFor(target)).toEqual(["lifecycle-owner"]);
    await memorySearch.removeAsk("lifecycle-two");
    await memorySearch.removeAsk("lifecycle-two");
    await memorySearch.registerAsk("lifecycle-two", "lifecycle-owner", target.bio);
    expect(await memorySearch.whoIsLookingFor(target)).toEqual([]);
  });
  it("does not revive an ask when resolution finishes before registration", async () => {
    const target = { ...people[0], id: "late-target", bio: "LateRegistrationTopic" };
    await memorySearch.removeAsk("late-ask");
    await memorySearch.registerAsk("late-ask", "late-owner", target.bio);
    expect(await memorySearch.whoIsLookingFor(target)).toEqual([]);
  });
});

describe("person updates without replacing evidence", () => {
  it("looks up fixture and newly ingested recipients without inventing unknown people", async () => {
    expect(await memorySearch.getPerson(people[0].id)).toEqual(people[0]);
    expect(await memorySearch.getPerson("unknown-recipient")).toBeUndefined();
    const person = { ...structuredClone(people[0]), id: "recipient-lookup-test", synthetic: false };
    await memorySearch.ingestPerson(person, [], 2);
    await memorySearch.ingestPerson({ ...person, name: "Stale" }, [], 1);
    expect(await memorySearch.getPerson(person.id)).toEqual(person);
  });

  it("reads several people at once, leaving out unknown IDs", async () => {
    expect(await memorySearch.getPeople([people[0].id, "unknown-recipient", people[1].id])).toEqual([people[0], people[1]]);
  });

  it("preserves repository evidence while updating profile fields and availability", async () => {
    const person = { ...structuredClone(people[0]), id: "evidence-update-test" };
    await memorySearch.ingestPerson(person, [{
      id: "repo-evidence-test", personId: person.id, kind: "repo", title: "EvidenceOnlyToken", text: "Repository evidence",
    }]);
    const updated = { ...person, name: "Updated name", freeTimes: [] };
    await memorySearch.ingestPerson(updated);
    const found = await memorySearch.searchCandidates("EvidenceOnlyToken", { excludeIds: [] });
    expect(found.map((candidate) => candidate.person.id)).toContain(person.id);
    expect(found.find((candidate) => candidate.person.id === person.id)?.person.name).toBe("Updated name");
    expect(await memorySearch.getAvailability([person.id])).toEqual({ [person.id]: [] });
    await memorySearch.ingestPerson(updated, []);
    expect((await memorySearch.searchCandidates("EvidenceOnlyToken", { excludeIds: [] })).map((candidate) => candidate.person.id)).not.toContain(person.id);
  });

  it("can register a new profile before repository evidence has been ingested", async () => {
    const person = { ...structuredClone(people[0]), id: "new-profile-test" };
    await memorySearch.ingestPerson(person);
    expect(await memorySearch.getAvailability([person.id])).toEqual({ [person.id]: person.freeTimes });
  });

  it("ignores older and unversioned writes after a versioned write, including their evidence", async () => {
    const person = { ...structuredClone(people[0]), id: "versioned-profile-test", bio: "RevisionToken" };
    const docs = [{ id: "versioned-profile-test:repo:doc", personId: person.id, kind: "repo" as const, title: "RevisionEvidence", text: "" }];
    await memorySearch.ingestPerson(person, docs, 2);
    const stale = { ...person, name: "Stale name" };
    await memorySearch.ingestPerson(stale, [], 1);
    await memorySearch.ingestPerson(stale, []);
    const hits = await memorySearch.searchCandidates("RevisionEvidence", { excludeIds: [] });
    expect(hits.find((hit) => hit.person.id === person.id)?.person).toEqual(person);
    await memorySearch.ingestPerson({ ...person, freeTimes: [] }, undefined, 3);
    expect(await memorySearch.getAvailability([person.id])).toEqual({ [person.id]: [] });
    await memorySearch.ingestPerson({ ...person, freeTimes: [] }, [], 3);
    expect(await memorySearch.searchCandidates("RevisionEvidence", { excludeIds: [] })).toEqual([]);
  });
});

describe("workplace", () => {
  it("is matched only when the person shows it", async () => {
    const atStripe = { ...structuredClone(people[0]), id: "workplace-test", bio: "", organisations: [], workplaceName: "Stripe",
      visibility: { country: true, workplace: true, hiring: true } };
    await memorySearch.ingestPerson(atStripe, [], 1);
    expect(await matchedIds("stripe")).toContain(atStripe.id);
    await memorySearch.ingestPerson({ ...atStripe, visibility: { ...atStripe.visibility, workplace: false } }, [], 2);
    expect(await matchedIds("stripe")).not.toContain(atStripe.id);
  });
});
