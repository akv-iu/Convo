import { describe, expect, it } from "vitest";
import type { MatchEvidence } from "@/contracts/types";
import { addEvidence, httpsLink, keyTerms, MAX_EVIDENCE, shownWorkplace } from "./evidence";

describe("httpsLink", () => {
  it("keeps well-formed https links and drops every other scheme or malformed value", () => {
    expect(httpsLink("https://github.com/etcd-io/raft")).toBe("https://github.com/etcd-io/raft");
    expect(httpsLink("HTTPS://GitHub.com/etcd-io/raft")).toBe("https://github.com/etcd-io/raft"); // what the contract accepts
    for (const bad of ["http://example.org", "javascript:alert(1)", "data:text/html,hi", "ftp://x.org/f", "not a url", "", undefined]) {
      expect(httpsLink(bad)).toBeUndefined();
    }
  });
});

describe("addEvidence", () => {
  it("adds evidence kinds only, without duplicates, up to the limit", () => {
    const list: MatchEvidence[] = [];
    addEvidence(list, { kind: "profile", title: "Generated profile" }); // not evidence
    addEvidence(list, { kind: "repo", title: "a", url: "https://x.org/a" });
    addEvidence(list, { kind: "repo", title: "a", url: "https://x.org/a" }); // duplicate
    addEvidence(list, { kind: "repo", title: "a", url: "http://x.org/a" }); // same item, unsafe link dropped: a different entry
    expect(list).toEqual([{ kind: "repo", title: "a", url: "https://x.org/a" }, { kind: "repo", title: "a" }]);
    for (let i = 0; i < 10; i++) addEvidence(list, { kind: "paper", title: `p${i}` });
    expect(list).toHaveLength(MAX_EVIDENCE);
  });
});

describe("keyTerms", () => {
  it("keeps what an ask is about and drops what kind of ask it is", () => {
    expect(keyTerms("I want to meet a potential employer from healthcare. What kind of roles are you hiring for?")).toBe("healthcare");
    expect(keyTerms("I want to work at Stripe. What experience did you have before joining, and what made the difference?")).toBe("Stripe");
    expect(keyTerms("How do I tune PostgreSQL autovacuum for a write-heavy table?")).toBe("tune PostgreSQL autovacuum write-heavy table");
  });

  it("keeps technical names with symbols, and falls back to the whole ask when nothing is left", () => {
    expect(keyTerms("Who knows C++ and Node.js or C#?")).toBe("C++ Node.js C#");
    expect(keyTerms("Who can help me?")).toBe("Who can help me?");
  });
});

describe("shownWorkplace", () => {
  const person = { workplaceName: " Stripe ", visibility: { country: true, workplace: true, hiring: true } } as Parameters<typeof shownWorkplace>[0];
  it("is the workplace only when the person shows it", () => {
    expect(shownWorkplace(person)).toBe("Stripe");
    expect(shownWorkplace({ ...person, visibility: { ...person.visibility!, workplace: false } })).toBe("");
    expect(shownWorkplace({ ...person, workplaceName: null })).toBe("");
  });
});
