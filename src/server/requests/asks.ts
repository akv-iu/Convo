import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../db";
import { asks, users } from "../../../db/schema";
import { Ask, ProfileVisibility, RefinedAsk, type MatchResult } from "@/contracts/types";
import { routes } from "@/contracts/routes";
import { getProfile } from "@/server/profile/service";
import { visibleCard } from "@/server/profile/visibility";
import { ai } from "@/server/ai";
import { search } from "@/server/search";
import { runMatch } from "@/server/pipeline";
import { getExclusions } from "./rejections";

class AskError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function createAsk(userId: string, text: string): Promise<{ askId: string; refined: RefinedAsk }> {
  if (text.trim().length < 3) throw new AskError("Enter a question with at least three characters.", 400);
  const requester = await getProfile(userId);
  let refined: RefinedAsk;
  try {
    refined = RefinedAsk.parse(await ai.refineAsk(text, requester));
    if (!refined.text.trim()) throw new Error("Empty refined question");
  } catch {
    throw new AskError("Question refinement is unavailable. Try again.", 503);
  }

  const askId = randomUUID();
  try {
    await db().insert(asks).values({ id: askId, userId, rawText: text, refined });
  } catch {
    throw new AskError("Ask storage is unavailable. The save could not be confirmed.", 503);
  }
  try {
    await search.registerAsk(askId, userId, refined.text);
  } catch {
    // shortcut: no durable search retry; add an outbox before C2 needs reliable registration.
    throw new AskError(`Ask saved with ID ${askId}, but search registration failed. Keep this ID; do not resubmit the question.`, 503);
  }
  return { askId, refined };
}

export async function matchAsk(userId: string, askId: string, query?: string): Promise<MatchResult[]> {
  let row: typeof asks.$inferSelect | undefined;
  try {
    [row] = await db().select().from(asks).where(and(eq(asks.id, askId), eq(asks.userId, userId))).limit(1);
  } catch {
    throw new AskError("Ask storage is unavailable. Try again.", 503);
  }
  if (!row) throw new AskError("Ask not found.", 404);
  let ask: Ask;
  try {
    ask = Ask.parse({ ...row, createdAt: row.createdAt.toISOString() });
  } catch {
    throw new AskError("Stored ask is invalid.", 503);
  }

  const requester = await getProfile(userId);
  const { excludeIds, hiddenBelowRank } = await getExclusions(askId);
  try {
    const pendingUsers = await db().select({ id: users.id }).from(users).where(eq(users.githubEvidencePending, true));
    const matches = await runMatch({
      ask, requester, query,
      excludeIds: [...(ask.softBlocker ? excludeIds : []), ...pendingUsers.map(user => user.id)],
      hiddenBelowRank,
    });
    if (!matches.length) return [];
    // Read current privacy settings even when search still has an older profile.
    const saved = await db().select({ id: users.id, visibility: users.visibility, githubEvidencePending: users.githubEvidencePending }).from(users)
      .where(inArray(users.id, matches.map(match => match.person.id)));
    // Do not expose old repository highlights or explanations while a refresh/revocation is pending.
    const pending = new Set(saved.filter(person => person.githubEvidencePending).map(person => person.id));
    const visibility = new Map(saved.map(person => [person.id, ProfileVisibility.parse(person.visibility)]));
    return routes.match.response.parse(matches.filter(match => !pending.has(match.person.id)).map(match => visibleCard(match,
      visibility.get(match.person.id) ?? (match.person.synthetic ? match.person.visibility :
        { country: false, workplace: false, hiring: false }))));
  } catch {
    throw new AskError("Matching is unavailable. Try again with the same ask ID.", 503);
  }
}
