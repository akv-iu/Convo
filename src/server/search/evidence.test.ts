import { describe, expect, it } from "vitest";
import type { MatchEvidence } from "@/contracts/types";
import { addEvidence, httpsLink, MAX_EVIDENCE } from "./evidence";

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
