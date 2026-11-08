import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { getToken, type JWT } from "next-auth/jwt";
import { db } from "../../../db";
import { authLinkAttempts } from "../../../db/schema";
import { githubIdentity, providerSubject } from "./identities";

// Claude's page-two URL can change here without accepting a client-controlled redirect.
export const ENRICHMENT_RETURN = "/signin";
export const LINK_COOKIE = "convo_github_link";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/api/", maxAge: 600 };
const failure = (code: string) => Object.assign(new Error("GitHub connection could not be confirmed."), { status: 409, code });

/** Read only the encrypted cookie session; bearer headers cannot authorize browser linking. */
export async function currentToken(): Promise<JWT | null> {
  const requestHeaders = new Headers(await headers());
  requestHeaders.delete("authorization");
  const secureCookie = /(?:^|;\s*)__Secure-authjs\.session-token(?:\.\d+)?=/.test(requestHeaders.get("cookie") ?? "");
  return getToken({ req: { headers: requestHeaders }, secret: process.env.AUTH_SECRET, secureCookie });
}
function sessionHash(token: JWT | null, owner: string) {
  if (!token || token.sub !== owner || typeof (token.sessionId ?? token.jti) !== "string") throw failure("github_reconnect");
  return digest(`${owner}:${token.sessionId ?? token.jti}`);
}

export async function beginGitHubConnection(userId: string) {
  const binding = sessionHash(await currentToken(), userId);
  const id = randomUUID();
  await db().execute(sql`with expired as (
    delete from ${authLinkAttempts} where expires_at < now() - interval '1 day'
      or (user_id = ${userId} and session_hash = ${binding} and state_hash is null)
  ) insert into ${authLinkAttempts} (id, user_id, session_hash, expires_at)
    values (${id}, ${userId}, ${binding}, now() + interval '10 minutes')`);
  (await cookies()).set(LINK_COOKIE, id, cookieOptions);
  return { status: "redirect" as const, path: "/api/auth/connect/github" };
}

export async function authorizeGitHubConnection(start: () => Promise<string>) {
  const jar = await cookies();
  const id = jar.get(LINK_COOKIE)?.value;
  const token = await currentToken();
  if (!id || !token?.sub) throw failure("github_reconnect");
  const binding = sessionHash(token, token.sub);
  const [attempt] = await db().select().from(authLinkAttempts).where(and(eq(authLinkAttempts.id, id),
    eq(authLinkAttempts.userId, token.sub), eq(authLinkAttempts.sessionHash, binding),
    isNull(authLinkAttempts.stateHash), isNull(authLinkAttempts.consumedAt), sql`${authLinkAttempts.expiresAt} > now()`)).limit(1);
  if (!attempt) throw failure("github_reconnect");
  const url = new URL(await start());
  const state = url.searchParams.get("state");
  if (url.origin !== "https://github.com" || url.pathname !== "/login/oauth/authorize" || !state
    || url.searchParams.get("scope") !== "" || url.searchParams.get("code_challenge_method") !== "S256") throw failure("provider_down");
  const updated = await db().update(authLinkAttempts).set({ stateHash: digest(state) })
    .where(and(eq(authLinkAttempts.id, id), isNull(authLinkAttempts.stateHash), isNull(authLinkAttempts.consumedAt))).returning({ id: authLinkAttempts.id });
  if (!updated[0]) throw failure("github_reconnect");
  return url.toString();
}

/** Called only after Auth.js has verified the provider response, PKCE and OAuth state. */
export async function completeGitHubConnection(state: string | null, subject: string, profile: unknown): Promise<JWT | null> {
  const jar = await cookies();
  const cookieId = jar.get(LINK_COOKIE)?.value;
  // Remember used/expired states for a day: losing a cookie must not turn linking into ordinary sign-in.
  const [attempt] = state ? await db().select().from(authLinkAttempts).where(eq(authLinkAttempts.stateHash, digest(state))).limit(1) : [];
  if (!attempt && !cookieId) return null;
  if (!attempt || cookieId !== attempt.id) throw failure("github_reconnect");
  const token = await currentToken();
  const binding = sessionHash(token, attempt.userId);
  if (binding !== attempt.sessionHash || attempt.consumedAt || attempt.expiresAt.getTime() <= Date.now()) throw failure("github_reconnect");
  const identity = githubIdentity.parse(profile);
  if (String(identity.id) !== providerSubject("github", subject)) throw failure("github_reconnect");
  const linked = await db().execute<{ user_id: string }>(sql`
    with claimed as (
      update ${authLinkAttempts} set consumed_at = now()
      where id = ${attempt.id} and user_id = ${attempt.userId} and session_hash = ${binding}
        and state_hash = ${digest(state!)} and consumed_at is null and expires_at > now()
      returning user_id
    )
    insert into auth_identities (provider, provider_account_id, user_id)
    select 'github', ${subject}, user_id from claimed
    on conflict (provider, provider_account_id) do update set user_id = auth_identities.user_id
      where auth_identities.user_id = excluded.user_id
    returning user_id
  `).catch((error: unknown) => {
    const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") throw failure("github_linked_elsewhere");
    throw error;
  });
  if (!linked.rows[0]) throw failure("github_linked_elsewhere");
  return token;
}

export async function clearConnection() {
  (await cookies()).set(LINK_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}

export async function accountState(userId: string) {
  const token = await currentToken();
  if (token?.sub !== userId) throw Object.assign(new Error("Sign in first."), { status: 401 });
  return token.signInProvider === "google" ? "google" as const : "github" as const;
}
