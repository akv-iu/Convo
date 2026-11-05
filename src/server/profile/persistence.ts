import { sql } from "drizzle-orm";
import { db } from "../../../db";
import { users } from "../../../db/schema";
import { buildProfile } from "./index";
import { githubUserId, loadGitHubProfile } from "./github";

export async function initializeGitHubProfile(accountId: string, profile: unknown, accessToken: string): Promise<void> {
  const github = await loadGitHubProfile(accountId, profile, accessToken);
  const { person } = buildProfile(githubUserId(accountId), github);
  await db().insert(users).values({
    id: person.id, githubLogin: person.githubLogin, name: person.name, bio: person.bio,
    languages: person.languages, organisations: person.organisations,
  }).onConflictDoUpdate({
    target: users.id,
    // Sign-in must not overwrite the user's edits, filters or saved availability.
    set: { githubLogin: person.githubLogin, revision: sql`${users.revision} + 1` },
  });
}
