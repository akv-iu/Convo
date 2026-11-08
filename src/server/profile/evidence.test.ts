import { expect, it } from "vitest";
import { approvedSnapshot, indexedEvidence, sourceRecords } from "./evidence";

const owner = "github:101";
const time = "2026-11-07T12:00:00.000Z";
const repo = { id: `${owner}:repo:one`, personId: owner, kind: "repo" as const, title: "one", text: "Legacy repository", url: "https://github.com/example/one" };
const user = { id: owner, githubLogin: "example", createdAt: new Date(time), githubEvidence: [repo], profileEvidence: null, profileSources: [] };
const evidence = (source: "github" | "research" | "public_profile" | "cv" = "research") => ({
  id: `${owner}:${source === "research" ? "paper" : source === "cv" ? "cv" : "profile_page"}:${source}`, personId: owner,
  sourceId: `${owner}:${source}`, source, kind: source === "research" ? "paper" : source === "cv" ? "cv" : "profile_page",
  title: "Professional work", excerpt: "Supporting text", retrievedAt: time,
  ...(source === "research" || source === "github" ? { url: "https://example.org/work" } : {}),
});

it("converts legacy evidence only when the general snapshot is null", () => {
  expect(indexedEvidence(user)).toEqual([repo]);
  expect(approvedSnapshot(user)[0]).toMatchObject({ source: "github", sourceId: `${owner}:github`, excerpt: repo.text, retrievedAt: time });
  expect(indexedEvidence({ ...user, profileEvidence: [] })).toEqual([]);
});
it("indexes all approved sources using EvidenceDoc, keeping private/source bookkeeping out", () => {
  const docs = [evidence("github"), evidence(), evidence("public_profile"), evidence("cv")];
  const indexed = indexedEvidence({ ...user, profileEvidence: docs });
  expect(indexed).toHaveLength(4);
  expect(indexed[1]).toMatchObject({ kind: "paper", text: "Supporting text" });
  expect(indexed[1]).not.toHaveProperty("excerpt");
  expect(indexed[1]).not.toHaveProperty("sourceId");
});
it("derives legacy source metadata, while an explicitly empty snapshot stays empty", () => {
  expect(sourceRecords(user)).toEqual([{ id: `${owner}:github`, source: "github", label: "GitHub", url: "https://github.com/example", evidenceCount: 1, approvedAt: time }]);
  expect(sourceRecords({ ...user, profileEvidence: [] })).toEqual([]);
});
it.each([
  [{ ...evidence(), personId: "someone-else" }],
  [{ ...evidence(), id: `${owner}:profile` }],
  [{ ...evidence(), sourceId: "someone-else:research" }],
  [{ ...evidence(), kind: "repo" }],
  [{ ...evidence(), url: undefined }],
  [evidence(), evidence()],
  [{ ...evidence("cv"), url: "https://example.org/private-cv" }],
  Array.from({ length: 11 }, (_, n) => ({ ...evidence(), id: `${owner}:paper:${n}` })),
  Array.from({ length: 6 }, (_, n) => ({ ...evidence("cv"), id: `${owner}:cv:${n}` })),
  Array.from({ length: 2 }, (_, n) => ({ ...evidence("public_profile"), id: `${owner}:profile_page:${n}` })),
])( "rejects foreign, untraceable, duplicate or excessive approved evidence", docs => {
  expect(() => indexedEvidence({ ...user, profileEvidence: docs })).toThrow();
});
it("rejects corrupt source metadata rather than hiding it as absent", () => {
  expect(() => sourceRecords({ ...user, profileEvidence: [], profileSources: {} })).toThrow();
  expect(() => sourceRecords({ ...user, profileEvidence: [], profileSources: null })).toThrow();
  expect(() => sourceRecords({ ...user, profileEvidence: [evidence()], profileSources: [] })).toThrow();
});
it("retains legacy repository evidence without an optional link", () => {
  const doc = { ...repo, url: undefined };
  expect(indexedEvidence({ ...user, githubEvidence: [doc] })).toEqual([doc]);
});
