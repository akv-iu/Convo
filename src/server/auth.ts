/**
 * Sign-in (B2). Auth.js with GitHub. In fake mode there is no sign-in: the
 * user is demo user A, or whoever the x-demo-user header names, so two
 * browser windows can play both sides.
 */
import NextAuth, { type Profile } from "next-auth";
import GitHub from "next-auth/providers/github";
import { cookies } from "next/headers";
import { DEMO_USER_A } from "@/contracts/fixtures";
import { config } from "@/server/config";
import { githubUserId, loadGitHubIdentity } from "@/server/profile/github";
import { initializeGitHubProfile } from "@/server/profile/persistence";
import { CONSENT_COOKIE, parseConsent } from "@/server/profile/consent";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [GitHub({
    authorization: { params: { scope: "" } }, // Public information needs no extra OAuth scopes.
    userinfo: {
      // GitHub's raw numeric ID differs from Auth.js's generic Profile type.
      request: async ({ tokens }: { tokens: { access_token?: string } }) => await loadGitHubIdentity(tokens.access_token) as unknown as Profile,
    },
    profile: (profile) => ({ id: String(profile.id), name: profile.name ?? profile.login, image: profile.avatar_url }),
  })],
  callbacks: {
    async signIn({ account, profile }) {
      if (config.fakeApi) return true;
      if (account?.provider !== "github" || !account.access_token) return false;
      try {
        const consent = parseConsent((await cookies()).get(CONSENT_COOKIE)?.value);
        await initializeGitHubProfile(account.providerAccountId, profile, account.access_token, consent);
        return true;
      } catch {
        // Provider and database errors may contain credentials; do not log them.
        console.error("[auth] GitHub profile initialization failed");
        return false;
      }
    },
    async jwt({ token, account, profile }) {
      delete token.email; // Remove email retained by sessions created with the old provider defaults.
      if (account?.provider === "github") token.sub = githubUserId(account.providerAccountId);
      if (account?.access_token) token.githubToken = account.access_token;
      if (profile && typeof profile.login === "string") token.githubLogin = profile.login;
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub ?? "";
      return session;
    },
  },
});

export async function getUserId(req: Request): Promise<string | null> {
  if (config.fakeApi) {
    const header = req.headers.get("x-demo-user");
    if (header !== null) return header;
    const cookie = req.headers.get("cookie")?.match(/(?:^|;\s*)convo_demo_user=([^;]+)/)?.[1];
    try { return cookie ? decodeURIComponent(cookie) : DEMO_USER_A; } catch { return DEMO_USER_A; }
  }
  const session = await auth();
  return session?.user?.id ?? null;
}
