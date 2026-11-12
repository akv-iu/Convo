import { describe, expect, it } from "vitest";
import { contentTerms, keywordQuery } from "./terms";

describe("the request matcher's keywords", () => {
  it("keeps what a sharpened question is about and drops how it's asked", () => {
    expect(contentTerms("How does Raft handle voting in practice, and where does that tend to break?")).toEqual(["raft", "voting"]);
    expect(contentTerms("How do I tune postgres autovacuum? What would you check first, and what's a common mistake to avoid?"))
      .toEqual(["tune", "postgres", "autovacuum"]);
    expect(contentTerms("I want a job at Grafana Labs. What did your own path look like, and what made the biggest difference?"))
      .toEqual(["job", "grafana", "labs"]);
  });

  it("keeps short technical words such as Go and C#'s letters", () => {
    expect(contentTerms("Should I learn Go or Rust for k8s operators?")).toEqual(["go", "rust", "k8s", "operators"]);
  });

  it("falls back to the whole text when nothing is left", () => {
    expect(keywordQuery("how does it work?")).toBe("how does it work?");
    expect(keywordQuery("Raft voting, in practice")).toBe("raft voting");
  });
});
