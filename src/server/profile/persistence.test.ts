import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "./fixtures/github.json";
import { consentSources } from "./consent";
import { people } from "@/contracts/fixtures";
import type { EvidenceDoc, Person } from "@/contracts/types";

const { query, ingestPerson } = vi.hoisted(() => ({ query: vi.fn(), ingestPerson: vi.fn() }));
vi.mock("@/server/search", () => ({ search: { ingestPerson } }));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(),
  neon: () => ({ query }),
}));
import { initializeGitHubProfile } from "./persistence";

const savedPerson: Person = { ...people[0], id: "github:101", githubLogin: "ada-example",
  name: "My edited name", bio: "My edited bio", workplaceName: "Acme", badgeColour: "lilac",
  visibility: { country: false, workplace: false, hiring: false } };
const evidence: EvidenceDoc[] = [{ id: "github:101:repo:scheduler", personId: "github:101",
  kind: "repo", title: "scheduler", text: "Fair task scheduling", url: "https://github.com/ada-example/scheduler" }];
function result(filters: Person["filters"] | null = null, docs: EvidenceDoc[] = [], revision = 1) {
  return { rows: [[savedPerson.id, savedPerson.githubLogin, savedPerson.name, savedPerson.bio,
    JSON.stringify(savedPerson.languages), JSON.stringify(savedPerson.organisations),
    filters === null ? null : JSON.stringify(filters), JSON.stringify(savedPerson.freeTimes), "2026-11-05T00:00:00Z", revision,
    savedPerson.workplaceName, savedPerson.badgeColour, JSON.stringify(savedPerson.visibility), JSON.stringify(docs), true]] };
}

beforeEach(() => {
  query.mockReset().mockResolvedValue(result());
  ingestPerson.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url) =>
    Response.json(String(url).includes("/repos?") ? fixtures[0].repos : fixtures[0].orgs)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("profile persistence through Drizzle", () => {
  it.each([
    { consent: [] as const, bio: "", languages: "[]", orgs: "[]" },
    { consent: ["profile"] as const, bio: "Builds scheduling tools", languages: "[]", orgs: "[]" },
    { consent: ["repos"] as const, bio: "", languages: '["Rust","TypeScript"]', orgs: "[]" },
    { consent: ["orgs"] as const, bio: "", languages: "[]", orgs: '["example-labs"]' },
  ])("stores no unselected optional fields for a new profile: $consent", async ({ consent, bio, languages, orgs }) => {
    await initializeGitHubProfile("101", fixtures[0].profile, "test-token", consent);
    expect(query.mock.calls[0][1].slice(0, 6)).toEqual(["github:101", "ada-example", "Ada Example", bio, languages, orgs]);
    const docs = JSON.parse(query.mock.calls[0][1][6]);
    expect(docs.map((doc: EvidenceDoc) => doc.title)).toEqual(consent.some(source => source === "repos") ? ["scheduler", "notes"] : []);
    expect(JSON.stringify(docs)).not.toMatch(/internal|Private work|Python|test-token/);
    expect(ingestPerson).not.toHaveBeenCalled();
    if (!consent.length) expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves existing profile edits even when signing in with no optional consent", async () => {
    await initializeGitHubProfile("101", fixtures[0].profile, "test-token", []);
    const [statement] = query.mock.calls[0];
    expect(statement.split("do update set")[1].split(" returning ")[0]).not.toMatch(/name"|bio|languages|organisations|filters|free_times|workplace_name|badge_colour|visibility/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("inserts public profile fields under the immutable account ID", async () => {
    await initializeGitHubProfile("101", fixtures[0].profile, "test-token", consentSources);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('insert into "users"');
    expect(params.slice(0, 6)).toEqual([
      "github:101", "ada-example", "Ada Example", "Builds scheduling tools", '["Rust","TypeScript"]', '["example-labs"]',
    ]);
    expect(JSON.stringify(params)).not.toMatch(/test-token|Python|internal/);
  });

  it("refreshes only the GitHub login and imported evidence on conflict, preserving edits and onboarding", async () => {
    await initializeGitHubProfile("101", { ...fixtures[0].profile, login: "renamed-example" }, "test-token", consentSources);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/on conflict \("id"\) do update set "github_login" = \$\d+, "revision" = "users"\."revision" \+ 1, "github_evidence" = \$\d+, "github_evidence_pending" = \$\d+ returning/);
    expect(params.at(-3)).toBe("renamed-example");
    expect(params.at(-2)).toBe(params[6]);
    expect(sql.split("do update set")[1].split(" returning ")[0]).not.toMatch(/name"|bio|languages|organisations|filters|free_times|workplace_name|badge_colour|visibility/);
  });

  it("indexes a completed profile using the persisted edits, evidence and revision from the same row", async () => {
    query.mockResolvedValueOnce(result(savedPerson.filters, evidence, 8));
    await initializeGitHubProfile("101", fixtures[0].profile, "test-token", consentSources);
    expect(ingestPerson).toHaveBeenCalledExactlyOnceWith(savedPerson, evidence, 8);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1]).toEqual([false, savedPerson.id, 8]);
  });

  it("clears imported evidence when signing in without repo consent, including the search copy", async () => {
    query.mockResolvedValueOnce(result(savedPerson.filters, [], 9));
    await initializeGitHubProfile("101", fixtures[0].profile, "test-token", []);
    expect(query.mock.calls[0][1][6]).toBe("[]");
    expect(query.mock.calls[0][1].at(-2)).toBe("[]");
    expect(ingestPerson).toHaveBeenCalledExactlyOnceWith(savedPerson, [], 9);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not index if the database does not confirm a saved row", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(initializeGitHubProfile("101", fixtures[0].profile, "test-token", [])).rejects.toThrow("did not confirm");
    expect(ingestPerson).not.toHaveBeenCalled();
  });

  it("retains the saved evidence and repairs search on a repeated sign-in after sync fails", async () => {
    query.mockResolvedValue(result(savedPerson.filters, evidence, 10));
    ingestPerson.mockRejectedValueOnce(new Error("private-search-token"));
    const error = await initializeGitHubProfile("101", fixtures[0].profile, "test-token", consentSources).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).toContain("Profile saved");
    expect(String(error)).not.toContain("private-search-token");
    await initializeGitHubProfile("101", fixtures[0].profile, "test-token", consentSources);
    expect(ingestPerson).toHaveBeenLastCalledWith(savedPerson, evidence, 10);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("does not write an incomplete profile when GitHub fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 429 })));
    await expect(initializeGitHubProfile("101", fixtures[0].profile, "test-token", consentSources)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it("propagates a database failure so sign-in cannot report persistence success", async () => {
    query.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(initializeGitHubProfile("101", fixtures[0].profile, "test-token", consentSources)).rejects.toThrow();
  });
});
