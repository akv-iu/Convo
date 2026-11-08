import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { profileEnrichmentStates } from "../../../../db/schema";
import { emptyOwnerData, enrichmentError, INPUT_TTL_MS, JOB_HISTORY_MS, OwnerData, StateError } from "./model";

/** Pure mutations can retry after a competing tab wins; never call a provider inside them. */
export async function mutateOwner<T>(userId: string, change: (data: OwnerData) => T): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db().select().from(profileEnrichmentStates).where(eq(profileEnrichmentStates.userId, userId)).limit(1);
      const data = row ? OwnerData.parse(row.document) : emptyOwnerData();
      const before = row ? JSON.stringify(data) : null;
      const result = change(data);
      const checked = OwnerData.parse(data);
      if (before === JSON.stringify(checked)) return structuredClone(result);
      const deadlines = [...(checked.cv ? [Date.parse(checked.cv.metadata.expiresAt)] : []),
        ...checked.discoveries.map(d => Date.parse(d.value.expiresAt)),
        ...checked.removedCvs.map(cv => cv.expiresAt),
        ...checked.jobs.map(j => Date.parse(j.value.expiresAt) + (j.input ? 0 : JOB_HISTORY_MS - INPUT_TTL_MS))];
      const nextSweepAt = deadlines.length ? new Date(Math.min(...deadlines)) : null;
      const saved = row
        ? await db().update(profileEnrichmentStates).set({ document: checked, version: row.version + 1, nextSweepAt })
          .where(and(eq(profileEnrichmentStates.userId, userId), eq(profileEnrichmentStates.version, row.version))).returning({ userId: profileEnrichmentStates.userId })
        : await db().insert(profileEnrichmentStates).values({ userId, document: checked, version: 1, nextSweepAt })
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
