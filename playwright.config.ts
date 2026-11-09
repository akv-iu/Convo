import { defineConfig, devices } from "@playwright/test";

// One build, two fake-API servers: ordinary specs run with profile enrichment off,
// tests/e2e/enrichment/ with it on. Dedicated ports, explicit flags and no reuse,
// so a server running the other flag (or a dev server) is never picked up: a busy
// port fails the run instead.
const OFF = "http://localhost:3100";
const ON = "http://localhost:3101";
const ENRICHMENT = "enrichment/**/*.spec.ts";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: OFF, trace: "retain-on-failure" },
  // Servers start in order, so the second uses the build the first one made.
  webServer: [
    {
      command: "npm run build && npm run start -- --port 3100",
      url: OFF,
      reuseExistingServer: false,
      env: { FAKE_API: "1", PROFILE_ENRICHMENT_ENABLED: "0" },
      timeout: 180_000,
    },
    {
      command: "npm run start -- --port 3101",
      url: ON,
      reuseExistingServer: false,
      env: { FAKE_API: "1", PROFILE_ENRICHMENT_ENABLED: "1" },
      timeout: 60_000,
    },
  ],
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] }, testIgnore: ENRICHMENT },
    { name: "laptop", use: { ...devices["Desktop Chrome"] }, testIgnore: ENRICHMENT },
    { name: "enrichment-phone", use: { ...devices["Pixel 7"], baseURL: ON }, testMatch: ENRICHMENT },
    { name: "enrichment-laptop", use: { ...devices["Desktop Chrome"], baseURL: ON }, testMatch: ENRICHMENT },
  ],
});
