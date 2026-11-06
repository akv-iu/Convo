import { sql } from "drizzle-orm";
import { db } from "../../../db";
import { users } from "../../../db/schema";
import { buildProfile } from "./index";
import { githubUserId, loadGitHubProfile } from "./github";
import type { GitHubConsent } from "./consent";
import { syncProfile } from "./service";

export async function initializeGitHubProfile(accountId: string, profile: unknown, accessToken: string, consent: GitHubConsent): Promise<void> {
  const github = await loadGitHubProfile(accountId, profile, accessToken, consent);
  const { person, evidence } = buildProfile(githubUserId(accountId), github);
  const [saved] = await db().insert(users).values({
    id: person.id, githubLogin: person.githubLogin, name: person.name, bio: person.bio,
    languages: person.languages, organisations: person.organisations, githubEvidence: evidence, githubEvidencePending: evidence.length > 0,
  }).onConflictDoUpdate({
    target: users.id,
    // Sign-in must not overwrite the user's edits, filters or saved availability.
    // Replace the imported snapshot, including clearing it when repos are not consented.
    set: {
      githubLogin: person.githubLogin, githubEvidence: evidence,
      githubEvidencePending: sql`${users.githubEvidencePending} or ${users.githubEvidence} is distinct from ${JSON.stringify(evidence)}::jsonb`,
      revision: sql`${users.revision} + 1`,
    },
  }).returning();
  if (!saved) throw new Error("Profile storage did not confirm the save. Retry sign-in.");
  if (saved.filters !== null) {
    try {
      await syncProfile(saved);
    } catch {
      // Search is a copy; its failure must not deny access to the saved profile.
      console.warn("[profile] Profile saved; search synchronization unconfirmed. Retry a profile save or sign-in.");
    }
  }
}
