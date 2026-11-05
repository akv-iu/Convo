/**
 * Sign-in (B2). Auth.js with GitHub. In fake mode there is no sign-in: the
 * user is demo user A, or whoever the x-demo-user header names, so two
 * browser windows can play both sides.
 */
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { DEMO_USER_A } from "@/contracts/fixtures";
import { config } from "@/server/config";
import { githubUserId } from "@/server/profile/github";
import { initializeGitHubProfile } from "@/server/profile/persistence";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  // Public repository reads do not need public_repo's write permission.
  providers: [GitHub],
  callbacks: {
    async signIn({ account, profile }) {
      if (config.fakeApi) return true;
      if (account?.provider !== "github" || !account.access_token) return false;
      try {
        await initializeGitHubProfile(account.providerAccountId, profile, account.access_token);
        return true;
      } catch {
        // Provider and database errors may contain credentials; do not log them.
        console.error("[auth] GitHub profile initialization failed");
        return false;
      }
    },
    async jwt({ token, account, profile }) {
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
  if (config.fakeApi) return req.headers.get("x-demo-user") ?? DEMO_USER_A;
  const session = await auth();
  return session?.user?.id ?? null;
}
