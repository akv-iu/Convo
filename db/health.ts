import { neon } from "@neondatabase/serverless";
import OpenAI from "openai";
import { client } from "@/server/search/elastic";

const TIMEOUT_MS = 5_000;
type DependencyStatus = "up" | "down";
type Health = { status: DependencyStatus; dependencies: Record<"postgres" | "elasticsearch" | "openai", DependencyStatus> };
let cached: { until: number; result: Promise<Health> } | undefined;

async function probe(check: () => Promise<unknown>): Promise<DependencyStatus> {
  try {
    await check();
    return "up";
  } catch {
    return "down";
  }
}

async function inspect(): Promise<Health> {
  const [postgres, elasticsearch, openai] = await Promise.all([
    probe(async () => {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error("Database is not configured");
      const rows = await neon(url).query("select 1 as ok", [], {
        fetchOptions: { signal: AbortSignal.timeout(TIMEOUT_MS) },
      });
      if (rows[0]?.ok !== 1) throw new Error("Unexpected database response");
    }),
    probe(async () => {
      if (!await client().ping({}, { requestTimeout: TIMEOUT_MS, maxRetries: 0 })) {
        throw new Error("Cluster did not answer the ping");
      }
    }),
    probe(async () => {
      const api = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 });
      // One metadata request, no generation or model constant shared with B1.
      await api.models.list();
    }),
  ]);
  return {
    status: [postgres, elasticsearch, openai].every(status => status === "up") ? "up" : "down",
    dependencies: { postgres, elasticsearch, openai },
  };
}

export function checkHealth(): Promise<Health> {
  // Share concurrent probes and bound polling cost per server instance; failures expire too.
  if (!cached || Date.now() >= cached.until) cached = { until: Date.now() + 30_000, result: inspect() };
  return cached.result;
}
