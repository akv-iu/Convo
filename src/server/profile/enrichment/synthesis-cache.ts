import { sql } from "drizzle-orm";
import { db } from "../../../../db";
import { aiCache, profileEnrichmentStates } from "../../../../db/schema";
import { profileCachePrefix } from "./model";

const lease = (owner: string, job: string, token: string) => sql`
  select s.user_id, s.version, s.document, j.job, (j.n - 1)::text as position
  from ${profileEnrichmentStates} s,
    lateral jsonb_array_elements(s.document->'jobs') with ordinality j(job, n)
  where s.user_id = ${owner} and j.job->'value'->>'jobId' = ${job}
    and j.job->'value'->>'state' = 'running' and j.job->'lease'->>'token' = ${token}
    and (j.job->'lease'->>'expiresAt')::numeric > extract(epoch from clock_timestamp()) * 1000
    and j.job->'value'->'selectionGeneration' = s.document->'generation'
    and (j.job->'value'->>'expiresAt')::timestamptz > clock_timestamp()
    and (j.job #>> '{input,cv,uploadId}' is null or (
      j.job #>> '{input,cv,uploadId}' = s.document #>> '{cv,metadata,uploadId}'
      and (s.document #>> '{cv,metadata,expiresAt}')::timestamptz > clock_timestamp()))
  for update of s`;

/** Cache failures cost a model call; they must not leak SQL parameters or private drafts. */
export async function readSynthesisCache(owner: string, job: string, token: string, key: string): Promise<unknown> {
  if (!key.startsWith(profileCachePrefix(owner))) return undefined;
  try {
    const result = await db().execute<{ value: unknown }>(sql`with leased as materialized (${lease(owner, job, token)})
      select c.value from ${aiCache} c where c.key = ${key} and c.kind = 'profile'
        and c.created_at > now() - interval '24 hours' and exists (select 1 from leased)`);
    return result.rows[0]?.value;
  } catch { return undefined; }
}

export async function writeSynthesisCache(owner: string, job: string, token: string, key: string, value: unknown): Promise<void> {
  if (!key.startsWith(profileCachePrefix(owner))) return;
  try {
    await db().execute(sql`with leased as materialized (${lease(owner, job, token)}), remembered as (
      update ${profileEnrichmentStates} s set document = jsonb_set(s.document,
        array['jobs', l.position, 'synthesisCacheKeys'],
        case when coalesce(s.document #> array['jobs', l.position, 'synthesisCacheKeys'], '[]'::jsonb) ? ${key}
          then s.document #> array['jobs', l.position, 'synthesisCacheKeys']
          else coalesce(s.document #> array['jobs', l.position, 'synthesisCacheKeys'], '[]'::jsonb) || ${JSON.stringify([key])}::jsonb end),
        version = s.version + 1 from leased l where s.user_id = l.user_id and s.version = l.version
          and s.document #>> array['jobs', l.position, 'value', 'jobId'] = ${job}
          and s.document #>> array['jobs', l.position, 'value', 'state'] = 'running'
          and s.document #>> array['jobs', l.position, 'lease', 'token'] = ${token}
          and (s.document #>> array['jobs', l.position, 'lease', 'expiresAt'])::numeric > extract(epoch from clock_timestamp()) * 1000
          and (s.document #>> array['jobs', l.position, 'value', 'expiresAt'])::timestamptz > clock_timestamp()
          and s.document #> array['jobs', l.position, 'value', 'selectionGeneration'] = s.document->'generation'
          and (s.document #>> array['jobs', l.position, 'input', 'cv', 'uploadId'] is null or (
            s.document #>> array['jobs', l.position, 'input', 'cv', 'uploadId'] = s.document #>> '{cv,metadata,uploadId}'
            and (s.document #>> '{cv,metadata,expiresAt}')::timestamptz > clock_timestamp()))
          and (jsonb_array_length(coalesce(s.document #> array['jobs', l.position, 'synthesisCacheKeys'], '[]'::jsonb)) < 8
            or s.document #> array['jobs', l.position, 'synthesisCacheKeys'] ? ${key})
      returning s.user_id
    ) insert into ${aiCache} (key, kind, value) select ${key}, 'profile', ${JSON.stringify(value)}::jsonb
      from remembered on conflict (key) do update set value = excluded.value, created_at = excluded.created_at`);
  } catch { /* The validated draft can still complete; a retry may regenerate it. */ }
}
