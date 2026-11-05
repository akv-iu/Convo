import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (Neon connection string).");
  return drizzle(neon(url), { schema });
}

let cached: ReturnType<typeof connect> | undefined;

/** Lazily connected so builds and the fake API never need a database. */
export function db() {
  cached ??= connect();
  return cached;
}
