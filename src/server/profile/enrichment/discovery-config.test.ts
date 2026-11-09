import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each([undefined, "", "recorded-server-key"])("reads independent server-only discovery credentials (%s)", async value => {
  vi.resetModules();
  vi.stubEnv("OPENALEX_API_KEY", value);
  vi.stubEnv("BRAVE_SEARCH_API_KEY", "recorded-brave-key");
  const { config } = await import("@/server/config");
  expect(config).toMatchObject({ openAlexApiKey: value ?? "", braveSearchApiKey: "recorded-brave-key" });
});

it("does not fall back to public credentials when private credentials are missing", async () => {
  vi.resetModules();
  vi.stubEnv("OPENALEX_API_KEY", undefined); vi.stubEnv("BRAVE_SEARCH_API_KEY", undefined);
  vi.stubEnv("NEXT_PUBLIC_OPENALEX_API_KEY", "public-value"); vi.stubEnv("NEXT_PUBLIC_BRAVE_SEARCH_API_KEY", "public-value");
  const { config } = await import("@/server/config");
  expect(config).toMatchObject({ openAlexApiKey: "", braveSearchApiKey: "" });
});
