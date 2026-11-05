/**
 * Drop and recreate the three indices from es/mappings (B1).
 *   npm run es:rebuild
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@elastic/elasticsearch";

const INDICES = ["people", "evidence", "asks"] as const;

export function client(): Client {
  const node = process.env.ELASTICSEARCH_URL;
  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  if (!node || !apiKey) throw new Error("ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY are not set.");
  return new Client({ node, auth: { apiKey } });
}

async function main() {
  const es = client();
  for (const name of INDICES) {
    const body = JSON.parse(await readFile(path.join(process.cwd(), "es", "mappings", `${name}.json`), "utf8"));
    if (await es.indices.exists({ index: name })) await es.indices.delete({ index: name });
    await es.indices.create({ index: name, ...body });
    console.log(`created ${name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
