import { describe, expect, it } from "vitest";
import { EnrichmentReason, StartEnrichment } from "@/contracts/enrichment";
import {
  DEFAULT_SOURCES,
  identityFrom,
  keyFor,
  normaliseOrcid,
  startBody,
  startProblems,
  type Picks,
  type SourceChoices,
} from "./enrichment";
import { readReason, reasonHelp } from "./reasons";

const identity = identityFrom({ name: " Ada Lovelace ", country: "gb", workplace: { kind: "custom", name: " Analytical Engines " } });
const none: Picks = { research: null, publicProfile: null, cvUploadId: null };
const allOff: SourceChoices = { github: { on: false, bio: true, repos: true, orgs: true }, research: false, publicProfile: false, cv: false };
const key = "6f1b9a52-3c0e-4e7a-9d1a-2b3c4d5e6f70";

describe("ORCID iDs", () => {
  it("accepts the usual ways of writing one and normalises them", () => {
    expect(normaliseOrcid("0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
    expect(normaliseOrcid(" https://orcid.org/0000-0002-1825-0097 ")).toBe("0000-0002-1825-0097");
    expect(normaliseOrcid("0000000218250097")).toBe("0000-0002-1825-0097");
    expect(normaliseOrcid("0000-0002-1694-233x")).toBe("0000-0002-1694-233X");
  });

  it("rejects a wrong check digit or anything that isn't an iD", () => {
    expect(normaliseOrcid("0000-0002-1825-0098")).toBeNull();
    expect(normaliseOrcid("0000-0002-1825")).toBeNull();
    expect(normaliseOrcid("not an orcid")).toBeNull();
  });
});

describe("page one identity", () => {
  it("trims, upper-cases the country and keeps a typed workplace without a directory ID", () => {
    expect(identity).toEqual({ name: "Ada Lovelace", country: "GB", workplaceName: "Analytical Engines", rorId: null, orcid: null });
  });

  it("sends no workplace for 'not with an organisation' and the directory ID for a listed one", () => {
    expect(identityFrom({ name: "A", country: "US", workplace: { kind: "none" }, orcid: "0000-0002-1825-0097" })).toMatchObject({
      workplaceName: null, rorId: null, orcid: "0000-0002-1825-0097",
    });
    const org = { id: "https://ror.org/00f54p054", name: "Stanford University", country: "US" };
    expect(identityFrom({ name: "A", country: "US", workplace: { kind: "org", org } })).toMatchObject({
      workplaceName: "Stanford University", rorId: "https://ror.org/00f54p054",
    });
  });
});

describe("the start request", () => {
  it("sends every switched-off source as off, which the contract accepts", () => {
    const body = startBody(identity, allOff, none);
    expect(body).toEqual({
      identity, github: { import: false, bio: false, repos: false, orgs: false }, research: null, publicProfile: null, cv: null,
    });
    expect(StartEnrichment.safeParse({ ...body, idempotencyKey: key }).success).toBe(true);
  });

  it("sends an enabled source with nothing chosen as a skip, and chosen ones as chosen", () => {
    const skipped = startBody(identity, { ...allOff, research: true, publicProfile: true }, none);
    expect(skipped.research).toEqual({ skip: true });
    expect(skipped.publicProfile).toEqual({ skip: true });

    const chosen = startBody(identity, { ...DEFAULT_SOURCES, cv: true }, {
      research: { discoveryId: "d1", candidateId: "a2" },
      publicProfile: { kind: "candidate", discoveryId: "d2", candidateId: "p0" },
      cvUploadId: "cv_1",
    });
    expect(chosen).toMatchObject({
      github: { import: true, bio: true, repos: true, orgs: true },
      research: { discoveryId: "d1", candidateId: "a2" },
      publicProfile: { discoveryId: "d2", candidateId: "p0" },
      cv: { uploadId: "cv_1" },
    });
    expect(StartEnrichment.safeParse({ ...chosen, idempotencyKey: key }).success).toBe(true);
  });

  it("sends a different link or pasted text in the contract's shapes", () => {
    const sources = { ...allOff, publicProfile: true };
    const url = startBody(identity, sources, { ...none, publicProfile: { kind: "url", url: "https://example.org/ada" } });
    const text = startBody(identity, sources, { ...none, publicProfile: { kind: "text", text: "Works on engines." } });
    expect(url.publicProfile).toEqual({ url: "https://example.org/ada" });
    expect(text.publicProfile).toEqual({ kind: "text", text: "Works on engines." });
    for (const body of [url, text]) expect(StartEnrichment.safeParse({ ...body, idempotencyKey: key }).success).toBe(true);
  });
});

describe("what stops Continue on page two", () => {
  const ready = { github: { connected: true }, profileUrlValid: true };

  it("lists nothing when every enabled source is ready", () => {
    expect(startProblems(DEFAULT_SOURCES, none, ready)).toEqual([]);
    expect(startProblems(allOff, none, { github: { connected: false }, profileUrlValid: false })).toEqual([]);
  });

  it("names each problem in screen order", () => {
    const sources: SourceChoices = { github: { on: true, bio: false, repos: false, orgs: false }, research: true, publicProfile: true, cv: true };
    expect(startProblems(sources, { ...none, publicProfile: { kind: "text", text: "  " } }, { github: { connected: false }, profileUrlValid: true }))
      .toEqual(["github_categories", "github_connect", "profile_text", "cv_missing"]);
    expect(startProblems({ ...allOff, publicProfile: true }, { ...none, publicProfile: { kind: "url", url: "http://x" } }, { ...ready, profileUrlValid: false }))
      .toEqual(["profile_url"]);
  });
});

describe("the idempotency key", () => {
  const body = startBody(identity, allOff, none);
  let n = 0;
  const fresh = () => `key-${++n}`;

  it("stays the same while the request is unchanged and changes with any choice", () => {
    const first = keyFor(body, null, fresh);
    expect(keyFor(body, first, fresh)).toBe(first);
    const changed = keyFor({ ...body, research: { skip: true } }, first, fresh);
    expect(changed.key).not.toBe(first.key);
  });
});

describe("help for import results", () => {
  it("has a title and a fix for every reason the contract can send", () => {
    for (const reason of EnrichmentReason.options) {
      expect(reasonHelp[reason].title.length, reason).toBeGreaterThan(0);
      expect(reasonHelp[reason].fix.length, reason).toBeGreaterThan(0);
    }
  });

  it("reads only known codes from the address bar", () => {
    expect(readReason("sign_in_cancelled")).toBe("sign_in_cancelled");
    expect(readReason("<script>")).toBeNull();
    expect(readReason(undefined)).toBeNull();
    expect(readReason(["github_linked_elsewhere"])).toBeNull();
  });
});
