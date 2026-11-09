import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe("enrichment release switch", () => {
  it.each([undefined, "", "0", "true", "1"])("only enables on explicit 1, received %s", async value => {
    vi.resetModules();
    vi.stubEnv("PROFILE_ENRICHMENT_ENABLED", value);
    const { config } = await import("@/server/config");
    expect(config.profileEnrichmentEnabled).toBe(value === "1");
  });
});
