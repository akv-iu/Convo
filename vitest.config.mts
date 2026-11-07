import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    env: { FAKE_API: "1" },
    coverage: {
      provider: "v8",
      // lcov feeds SonarQube Cloud; html is the CI artifact.
      reporter: ["text-summary", "html", "lcov"],
      include: ["src/server/**", "src/contracts/**", "src/app/api/**"],
      exclude: ["**/*.test.ts", "src/contracts/fixtures/**"],
      thresholds: { lines: 60 },
    },
  },
});
