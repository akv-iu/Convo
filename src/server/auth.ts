/** Auth.js owns provider verification; Lanyard owns stable account IDs and explicit linking. */
import { randomUUID } from "node:crypto";
import NextAuth, { type NextAuthConfig, type Profile } from "next-auth";
import type { JWT } from "next-auth/jwt";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { DEMO_USER_A } from "@/contracts/fixtures";
import { config } from "@/server/config";
import { githubUserId, loadGitHubIdentity } from "@/server/profile/github";
import { initializeGitHubProfile } from "@/server/profile/persistence";
import { CONSENT_COOKIE, parseConsent } from "@/server/profile/consent";
import { githubIdentity, resolveIdentity, refreshGitHubHandle, providerSubject } from "@/server/profile/identities";
import { clearConnection, completeGitHubConnection, ENRICHMENT_RETURN } from "@/server/profile/connection";

export function authOptions(request?: Request): NextAuthConfig {
  let linkedSession: JWT | null = null;
  return {
    trustHost: true,
    session: { strategy: "jwt" },
    ...(config.profileEnrichmentEnabled ? { pages: { error: "/api/auth/enrichment-error" } } : {}),
    logger: { error: () => console.error("[auth] Authentication failed."), warn: () => console.warn("[auth] Authentication warning."), debug: () => undefined },
    providers: [GitHub({
      authorization: { params: { scope: "" } },
      checks: ["pkce", "state"],
      userinfo: {
        request: async ({ tokens }: { tokens: { access_token?: string } }) => await loadGitHubIdentity(tokens.access_token) as unknown as Profile,
      },
      profile: (profile) => ({ id: String(profile.id), name: config.profileEnrichmentEnabled ? undefined : profile.name ?? profile.login,
        image: config.profileEnrichmentEnabled ? undefined : profile.avatar_url }),
    }), ...(config.profileEnrichmentEnabled ? [Google({
      authorization: { params: { scope: "openid profile" } },
      checks: ["pkce", "state", "nonce"],
      // Do not copy Google name, email, picture or tokens into profile/session storage.
      profile: profile => ({ id: providerSubject("google", profile.sub) }),
    })] : [])],
    callbacks: {
      async signIn({ user, account, profile }) {
        if (config.fakeApi) return true;
        if (!account || !["github", "google"].includes(account.provider) || !account.access_token) return false;
        try {
          if (!config.profileEnrichmentEnabled) {
            if (account.provider !== "github") return false;
            const consent = parseConsent((await cookies()).get(CONSENT_COOKIE)?.value);
            await initializeGitHubProfile(account.providerAccountId, profile, account.access_token, consent);
            return true;
          }
          if (account.provider === "github") {
            const identity = githubIdentity.parse(profile);
            if (String(identity.id) !== account.providerAccountId) throw new Error("Invalid provider identity.");
            linkedSession = await completeGitHubConnection(request ? new URL(request.url).searchParams.get("state") : null,
              account.providerAccountId, profile);
            user.id = linkedSession?.sub ?? await resolveIdentity("github", account.providerAccountId, identity.login);
            if (!user.id) throw new Error("Missing account owner.");
            await refreshGitHubHandle(user.id, identity.login);
            await clearConnection();
          } else {
            if (!profile || profile.sub !== account.providerAccountId) throw new Error("Invalid provider identity.");
            user.id = await resolveIdentity("google", account.providerAccountId, null);
          }
          return true;
        } catch (error) {
          console.error("[auth] Account initialization failed.");
          if (!config.profileEnrichmentEnabled) return false;
          await clearConnection();
          const code = error && typeof error === "object" && "code" in error
            && ["github_linked_elsewhere", "github_reconnect"].includes(String(error.code)) ? String(error.code) : "provider_down";
          return `${ENRICHMENT_RETURN}?enrichmentError=${code}`;
        }
      },
      async jwt({ token, account, profile, user }) {
        delete token.email;
        if (account) {
          if (config.profileEnrichmentEnabled) {
            if (!user?.id) return null;
            token.sub = user.id;
            token.sessionId = linkedSession?.sessionId ?? randomUUID();
            token.signInProvider = linkedSession?.signInProvider ?? account.provider;
          } else if (account.provider === "github") token.sub = githubUserId(account.providerAccountId);
          if (account.provider === "github") token.githubToken = account.access_token;
          else { delete token.githubToken; delete token.githubLogin; }
          if (account.provider === "github" && profile && typeof profile.login === "string") token.githubLogin = profile.login;
        }
        if (config.profileEnrichmentEnabled) { delete token.name; delete token.picture; }
        return token;
      },
      async session({ session, token }) {
        if (config.profileEnrichmentEnabled) return { expires: session.expires, user: { id: token.sub ?? "" } };
        session.user.id = token.sub ?? "";
        return session;
      },
      async redirect({ url, baseUrl }) {
        const target = new URL(url, baseUrl);
        return target.origin === new URL(baseUrl).origin ? target.toString() : new URL(ENRICHMENT_RETURN, baseUrl).toString();
      },
    },
  };
}

const nextAuth = NextAuth(request => authOptions(request));
export const { auth, signIn, signOut } = nextAuth;
function withCancellation(handler: (req: NextRequest) => Promise<Response>) {
  return async (req: NextRequest) => {
    const response = await handler(req);
    const url = new URL(req.url);
    // Let Auth.js validate even denied responses; only normalize its resulting error redirect.
    const location = response.headers.get("location");
    if (config.profileEnrichmentEnabled && url.pathname.startsWith("/api/auth/callback/")
      && url.searchParams.get("error") === "access_denied" && location
      && new URL(location, url).pathname === "/api/auth/enrichment-error") {
      const connecting = !!(await cookies()).get("convo_github_link")?.value;
      await clearConnection();
      const code = connecting ? "github_connect_cancelled" : "sign_in_cancelled";
      const result = new Response(response.body, response);
      result.headers.set("location", new URL(`${ENRICHMENT_RETURN}?enrichmentError=${code}`, url).toString());
      return result;
    }
    return response;
  };
}
export const handlers = { GET: withCancellation(nextAuth.handlers.GET), POST: withCancellation(nextAuth.handlers.POST) };

export async function getUserId(req: Request): Promise<string | null> {
  if (config.fakeApi) return req.headers.get("x-demo-user") ?? DEMO_USER_A;
  const session = await auth();
  return session?.user?.id ?? null;
}
