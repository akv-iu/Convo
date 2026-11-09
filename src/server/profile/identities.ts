import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import { authIdentities, users } from "../../../db/schema";
import { syncProfile } from "./service";

export const Provider = z.enum(["google", "github"]);
export type Provider = z.infer<typeof Provider>;
export const githubIdentity = z.object({ id: z.number().int().positive(), login: z.string().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i) });

export function providerSubject(provider: Provider, subject: string): string {
  if (!(provider === "github" ? /^[1-9]\d*$/ : /^[A-Za-z0-9_-]{1,255}$/).test(subject)) throw new Error("Invalid provider identity.");
  return subject;
}

/** The unique provider subject decides ownership, never email, name or a mutable handle. */
export async function resolveIdentity(provider: Provider, subject: string, login: string | null): Promise<string> {
  providerSubject(provider, subject);
  const id = `${provider}:${subject}`;
  const result = await db().execute<{ user_id: string; created_id: string | null }>(sql`
    with known as (
      select user_id from ${authIdentities} where provider = ${provider} and provider_account_id = ${subject}
    ), created as (
      insert into ${users} (id, github_login, name)
      select ${id}, ${login}, '' where not exists (select 1 from known)
      on conflict (id) do nothing returning id
    )
    insert into ${authIdentities} (provider, provider_account_id, user_id)
    select ${provider}, ${subject}, coalesce((select user_id from known), ${id})
    on conflict (provider, provider_account_id) do update set user_id = auth_identities.user_id
    returning user_id, (select id from created) as created_id
  `);
  const owner = result.rows[0]?.user_id;
  if (!owner) throw new Error("Account storage did not confirm ownership.");
  // A concurrent explicit link can win while this sign-up creates its provisional row.
  if (owner !== id && result.rows[0].created_id === id) await db().execute(sql`delete from ${users} where id = ${id} and filters is null
    and not exists (select 1 from ${authIdentities} where user_id = ${id})`);
  return owner;
}

export async function refreshGitHubHandle(userId: string, login: string): Promise<void> {
  const [saved] = await db().update(users).set({ githubLogin: login,
    revision: sql`${users.revision} + case when ${users.githubLogin} is distinct from ${login} then 1 else 0 end`,
  }).where(eq(users.id, userId)).returning();
  if (!saved) throw new Error("Profile storage did not confirm the save.");
  if (saved.filters !== null) {
    try { await syncProfile(saved); }
    catch { console.warn("[auth] Profile saved; search synchronization pending."); }
  }
}

export async function readAccountState(userId: string, provider: Provider) {
  const [saved] = await db().select({ githubLogin: users.githubLogin, filters: users.filters }).from(users).where(eq(users.id, userId)).limit(1);
  if (!saved) throw Object.assign(new Error("Account not found."), { status: 404 });
  const [github] = await db().select({ id: authIdentities.providerAccountId }).from(authIdentities)
    .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, "github"))).limit(1);
  return { signIn: { provider }, github: { connected: !!github, login: github ? saved.githubLogin : null },
    onboarded: saved.filters !== null, identity: null, job: null, pendingCv: null };
}
