/**
 * Drop and recreate the three indices from es/mappings (B1). Deletes all indexed
 * data: run scripts/seed.ts afterwards to restore approved evidence from all
 * four sources, expertise and saved revisions. Failed users are reported by ID;
 * valid users still recover and the seed exits non-zero. The synonym list lives in
 * es/mappings/evidence.json, so changing it also needs a rebuild.
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs es/rebuild.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { client, INDEX } from "@/server/search/elastic";

async function main() {
  const es = client();
  await Promise.all([INDEX.people, INDEX.evidence, INDEX.asks].map(async (name) => {
    const body = JSON.parse(await readFile(path.join(process.cwd(), "es", "mappings", `${name}.json`), "utf8"));
    if (await es.indices.exists({ index: name })) await es.indices.delete({ index: name });
    await es.indices.create({ index: name, ...body });
    console.log(`created ${name}`);
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
