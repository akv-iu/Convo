/**
 * Scheduled cleanup of expired private profile-enrichment input (Vercel Cron, vercel.json). An
 * operational endpoint, deliberately outside the application API contract, like /api/health.
 *
 * Authenticated by CRON_SECRET before anything else; with no secret configured it refuses every
 * request. It runs whether or not profile enrichment is switched on, so input staged before the
 * feature was turned off still expires. It reuses the cleanup kernel (cleanupExpired, 25 due owners per
 * batch) until nothing is due, within a time budget. The response holds aggregate counts only: no owner
 * IDs, private text or provider errors, and nothing is logged.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { config } from "@/server/config";
import { cleanupExpired } from "@/server/profile/enrichment/state";

export const maxDuration = 60;
// Stop starting batches after this, leaving room for the batch in progress inside maxDuration.
const BUDGET_MS = 30_000;
// 40 batches of 25: far beyond expected daily volume; a run that hits it reports stoppedEarly.
const MAX_BATCHES = 40;

const reply = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Constant-time comparison of the whole header, whatever its length. */
function authorized(header: string | null, secret: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

export async function GET(request: Request) {
  // Always at request time: never prerendered, so a build without the secret can't bake in a response.
  await connection();
  if (!config.cronSecret) return reply(503, { status: "not_configured" });
  if (!authorized(request.headers.get("authorization"), config.cronSecret)) return reply(401, { status: "unauthorized" });

  const started = Date.now();
  let processed = 0;
  let failed = 0; // failed owner attempts; each is deferred ten minutes by the kernel
  let batches = 0;
  let stoppedEarly = false;
  try {
    for (;;) {
      if (batches >= MAX_BATCHES || Date.now() - started >= BUDGET_MS) {
        stoppedEarly = true;
        break;
      }
      const batch = await cleanupExpired();
      batches++;
      processed += batch.processed;
      failed += batch.failed;
      if (batch.processed + batch.failed === 0) break; // nothing left due
    }
  } catch {
    // Listing due owners failed (storage unavailable). The error may carry SQL parameters: never returned or logged.
    return reply(503, { status: "failed", processed, failed, batches, stoppedEarly: true });
  }
  // Non-2xx when anything is left, so Vercel's cron log shows the run as failed.
  const complete = failed === 0 && !stoppedEarly;
  return reply(complete ? 200 : 500, { status: complete ? "complete" : "partial", processed, failed, batches, stoppedEarly });
}
