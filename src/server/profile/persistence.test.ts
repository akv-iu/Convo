import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "./fixtures/github.json";

const { query } = vi.hoisted(() => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(),
  neon: () => ({ query }),
}));
import { initializeGitHubProfile } from "./persistence";

beforeEach(() => {
  query.mockClear();
  query.mockResolvedValue({ rows: [] });
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url) =>
    Response.json(String(url).includes("/repos?") ? fixtures[0].repos : fixtures[0].orgs)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("profile persistence through Drizzle", () => {
  it("inserts public profile fields under the immutable account ID", async () => {
    await initializeGitHubProfile("101", fixtures[0].profile, "test-token");
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('insert into "users"');
    expect(params.slice(0, 6)).toEqual([
      "github:101", "ada-example", "Ada Example", "Builds scheduling tools", '["Rust","TypeScript"]', '["example-labs"]',
    ]);
    expect(JSON.stringify(params)).not.toMatch(/test-token|Python|internal/);
  });

  it("only refreshes the GitHub login on conflict, preserving edits and onboarding", async () => {
    await initializeGitHubProfile("101", { ...fixtures[0].profile, login: "renamed-example" }, "test-token");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/on conflict \("id"\) do update set "github_login" = \$\d+$/);
    expect(params.at(-1)).toBe("renamed-example");
    expect(sql.split("do update set")[1]).not.toMatch(/name"|bio|languages|organisations|filters|free_times/);
  });

  it("does not write an incomplete profile when GitHub fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 429 })));
    await expect(initializeGitHubProfile("101", fixtures[0].profile, "test-token")).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it("propagates a database failure so sign-in cannot report persistence success", async () => {
    query.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(initializeGitHubProfile("101", fixtures[0].profile, "test-token")).rejects.toThrow();
  });
});
