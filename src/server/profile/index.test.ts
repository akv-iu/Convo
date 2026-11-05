import { describe, expect, it } from "vitest";
import { EvidenceDoc } from "@/contracts/types";
import { buildProfile } from "./index";
import fixtures from "./fixtures/github.json";

describe("GitHub profile builder", () => {
  it.each([
    { index: 0, name: "Ada Example", languages: ["Rust", "TypeScript"], organisations: ["example-labs"], repos: ["scheduler", "notes"] },
    { index: 1, name: "newcomer-example", languages: [], organisations: [], repos: [] },
    { index: 2, name: "sam-example", languages: ["Go"], organisations: [], repos: ["another-tool", "tiny-tool"] },
  ])("builds a truthful profile from fixture $index", ({ index, name, languages, organisations, repos }) => {
    const saved = fixtures[index];
    const result = buildProfile(`github:${saved.profile.id}`, {
      ...saved.profile, repos: saved.repos.filter((repo) => !repo.private), orgs: saved.orgs,
    });
    expect(result.person).toEqual({
      id: `github:${saved.profile.id}`, githubLogin: saved.profile.login,
      name, bio: saved.profile.bio ?? "", languages, organisations, synthetic: false,
    });
    expect(result.evidence.map((doc) => doc.title)).toEqual(repos);
    for (const doc of result.evidence) expect(EvidenceDoc.safeParse(doc).success).toBe(true);
    if (index === 2) {
      expect(result.evidence[1]).toMatchObject({
        id: "github:103:repo:tiny-tool", personId: "github:103", kind: "repo",
        text: "tiny-tool. Language: Go.", url: "https://github.com/sam-example/tiny-tool",
      });
    }
  });

  it("selects the twenty most starred repositories without mutating the input", () => {
    const repos = Array.from({ length: 25 }, (_, i) => ({
      name: `repo-${i}`, description: `Project ${i}`, language: null,
      html_url: `https://github.com/example/repo-${i}`, stargazers_count: i,
    }));
    const { evidence } = buildProfile("github:1", { login: "example", name: null, bio: null, repos, orgs: [] });
    expect(evidence).toHaveLength(20);
    expect(evidence[0].title).toBe("repo-24");
    expect(evidence[19].title).toBe("repo-5");
    expect(repos[0].name).toBe("repo-0");
  });
});
