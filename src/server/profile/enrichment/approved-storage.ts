import { eq, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { aiCache, profileEnrichmentStates, users } from "../../../../db/schema";
import { approvedSnapshot, sourceRecords } from "../evidence";
import { readUser, toPerson } from "../service";
import { cacheKeys, enrichmentError, OwnerData, profileCachePrefix, StateError } from "./model";
import { mutateOwner, nextSweepAt } from "./storage";

/** Both row versions fence the commit; a conflict reruns only this pure mutation, never a provider. */
export async function mutateApprovedProfile(owner: string,
  change: (user: typeof users.$inferSelect, data: OwnerData) => boolean): Promise<typeof users.$inferSelect> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [user, rows] = await Promise.all([readUser(owner), db().select().from(profileEnrichmentStates).where(eq(profileEnrichmentStates.userId, owner)).limit(1)]);
      const row = rows[0];
      if (!row) { await mutateOwner(owner, () => undefined); continue; }
      const data = OwnerData.parse(row.document);
      const previousKeys = cacheKeys(data);
      // The receipt can be newer than the parallel profile read; repair its committed revision.
      if (!change(user, data)) return await readUser(owner);
      approvedSnapshot(user); sourceRecords(user); if (user.filters !== null) toPerson(user);
      const checked = OwnerData.parse(data); const revision = user.revision;
      const removed = previousKeys.filter(key => !cacheKeys(checked).includes(key));
      const result = await db().execute<{ saved: string; staged: string }>(sql`
        with locked as materialized (
          select u.id from ${users} u join ${profileEnrichmentStates} s on s.user_id = u.id
          where u.id = ${owner} and u.revision = ${revision} and s.version = ${row.version}
          for update of u, s
        ), saved as (
          update ${users} set bio = ${user.bio}, expertise = ${user.expertise === null ? null : JSON.stringify(user.expertise)}::jsonb,
            text_version = ${user.textVersion}, profile_evidence = ${JSON.stringify(user.profileEvidence)}::jsonb,
            profile_sources = ${JSON.stringify(user.profileSources)}::jsonb, profile_evidence_pending = ${user.profileEvidencePending},
            github_evidence = ${JSON.stringify(user.githubEvidence)}::jsonb, github_evidence_pending = ${user.githubEvidencePending},
            revision = ${revision + 1}
          where id in (select id from locked) returning id
        ), staged as (
          update ${profileEnrichmentStates} set document = ${JSON.stringify(checked)}::jsonb,
            version = ${row.version + 1}, next_sweep_at = ${nextSweepAt(checked)}
          where user_id in (select id from locked) returning user_id
        ), purged as (
          delete from ${aiCache} where kind = 'profile'
            and key like ${profileCachePrefix(owner) + "%"}
            and key in (select jsonb_array_elements_text(${JSON.stringify(removed)}::jsonb))
            and exists (select 1 from staged)
        ) select (select count(*) from saved) as saved, (select count(*) from staged) as staged
      `);
      if (Number(result.rows[0]?.saved) === 1 && Number(result.rows[0]?.staged) === 1) return { ...user, revision: revision + 1 };
    } catch (error) {
      if (error instanceof StateError) throw error;
      enrichmentError("provider_down", 503);
    }
  }
  enrichmentError("running", 409, 1);
}
