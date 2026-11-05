import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: { FAKE_API: "1" },
    coverage: {
      provider: "v8",
      include: ["src/server/**", "src/contracts/**"],
      exclude: ["**/*.test.ts", "src/contracts/fixtures/**"],
      thresholds: { lines: 60 },
    },
  },
});
