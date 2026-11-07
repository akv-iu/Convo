import { readFileSync, readdirSync } from "node:fs";
import { it } from "vitest";

it("parses every Dash0 JSON asset", () => {
  const directory = new URL("../../../../dash0/", import.meta.url);
  for (const file of readdirSync(directory).filter(file => file.endsWith(".json"))) {
    JSON.parse(readFileSync(new URL(file, directory), "utf8"));
  }
});
