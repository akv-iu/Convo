import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { aiCache, profileEnrichmentStates } from "../../../../db/schema";
import { cacheKeys, emptyOwnerData, enrichmentError, INPUT_TTL_MS, JOB_HISTORY_MS, OwnerData, profileCachePrefix, StateError } from "./model";

export function nextSweepAt(data: OwnerData): Date | null {
  const deadlines = [...(data.cv ? [Date.parse(data.cv.metadata.expiresAt)] : []),
    ...data.discoveries.map(d => Date.parse(d.value.expiresAt)), ...data.removedCvs.map(cv => cv.expiresAt),
    ...data.jobs.map(j => Date.parse(j.value.expiresAt) + (j.input ? 0 : JOB_HISTORY_MS - INPUT_TTL_MS))];
  return deadlines.length ? new Date(Math.min(...deadlines)) : null;
}

/** Pure mutations can retry after a competing tab wins; never call a provider inside them. */
export async function mutateOwner<T>(userId: string, change: (data: OwnerData) => T): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db().select().from(profileEnrichmentStates).where(eq(profileEnrichmentStates.userId, userId)).limit(1);
      const data = row ? OwnerData.parse(row.document) : emptyOwnerData();
      const previousKeys = cacheKeys(data);
      const before = row ? JSON.stringify(data) : null;
      const result = change(data);
      const checked = OwnerData.parse(data);
      if (before === JSON.stringify(checked)) return structuredClone(result);
      const deadline = nextSweepAt(checked);
      const removed = previousKeys.filter(key => !cacheKeys(checked).includes(key));
      const saved = row && removed.length
        ? (await db().execute<{userId:string}>(sql`with saved as (
            update ${profileEnrichmentStates} set document = ${JSON.stringify(checked)}::jsonb,
              version = ${row.version + 1}, next_sweep_at = ${deadline}
            where user_id = ${userId} and version = ${row.version} returning user_id
          ), purged as (
            delete from ${aiCache} where kind = 'profile'
              and key like ${profileCachePrefix(userId) + "%"}
              and key in (select jsonb_array_elements_text(${JSON.stringify(removed)}::jsonb))
              and exists (select 1 from saved)
          ) select user_id as "userId" from saved`)).rows
        : row
        ? await db().update(profileEnrichmentStates).set({ document: checked, version: row.version + 1, nextSweepAt: deadline })
          .where(and(eq(profileEnrichmentStates.userId, userId), eq(profileEnrichmentStates.version, row.version))).returning({ userId: profileEnrichmentStates.userId })
        : await db().insert(profileEnrichmentStates).values({ userId, document: checked, version: 1, nextSweepAt: deadline })
          .onConflictDoNothing().returning({ userId: profileEnrichmentStates.userId });
      if (saved[0]) return structuredClone(result);
    } catch (error) {
      if (error instanceof StateError) throw error;
      // Drizzle errors include SQL parameters, including private input. Do not retain/log their cause.
      enrichmentError("provider_down", 503);
    }
  }
  enrichmentError("running", 409, 1);
}

/** Bounded operational hook; scheduling/authentication ships before private-input enablement. */
export async function ownersDueForCleanup(limit = 25): Promise<string[]> {
  try {
    const rows = await db().select({ userId: profileEnrichmentStates.userId }).from(profileEnrichmentStates)
      .where(sql`${profileEnrichmentStates.nextSweepAt} <= now()`).orderBy(profileEnrichmentStates.nextSweepAt).limit(Math.min(100, Math.max(1, limit)));
    return rows.map(row => row.userId);
  } catch { enrichmentError("provider_down", 503); }
}

/** Delay failed due rows without reading or overwriting their private document or a repaired deadline. */
export async function deferCleanup(userId: string): Promise<void> {
  try {
    await db().update(profileEnrichmentStates).set({ nextSweepAt: new Date(Date.now() + 600_000) })
      .where(and(eq(profileEnrichmentStates.userId, userId), sql`${profileEnrichmentStates.nextSweepAt} <= now()`));
  } catch { enrichmentError("provider_down", 503); }
}
