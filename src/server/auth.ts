/**
 * Sign-in (B2). Auth.js with GitHub. In fake mode there is no sign-in: the
 * user is demo user A, or whoever the x-demo-user header names, so two
 * browser windows can play both sides.
 */
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { DEMO_USER_A } from "@/contracts/fixtures";
import { config } from "@/server/config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    GitHub({
      // read:user gives the profile; public_repo lists repos for the profile builder
      authorization: { params: { scope: "read:user user:email public_repo" } },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
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
