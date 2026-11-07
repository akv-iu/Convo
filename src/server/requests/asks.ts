import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { after } from "next/server";
import { db } from "../../../db";
import { asks, rejections, requests, users } from "../../../db/schema";
import { Ask, ProfileVisibility, RefinedAsk, type MatchResult } from "@/contracts/types";
import { routes } from "@/contracts/routes";
import { getProfile } from "@/server/profile/service";
import { visibleCard } from "@/server/profile/visibility";
import { ai, AskBlockedError } from "@/server/ai";
import { search } from "@/server/search";
import { runMatch } from "@/server/pipeline";
import { getExclusions } from "./rejections";

class AskError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function registerSavedAsk(askId: string, userId: string, text: string): Promise<void> {
  try {
    await search.registerAsk(askId, userId, text);
  } catch {
    console.warn("[asks] Ask saved; search registration failed. A later match will retry.");
  }
}

/**
 * Best effort: runs the ask's first match after the response is sent, while the asker reads the
 * refined question, so its explanations (about 3 s for ten new cards) are usually cached by the
 * time the asker opens the results. If the asker is quicker, both runs pay for the same lines.
 */
function warmFirstMatch(userId: string, askId: string): void {
  try {
    after(() => matchAsk(userId, askId).catch(() => {
      console.warn("[asks] Background first match failed; the asker's own first match computes it.");
    }));
  } catch {
    // after() throws outside a request (unit tests, scripts), where nothing waits on a response.
  }
}

export async function createAsk(userId: string, text: string): Promise<{ askId: string; refined: RefinedAsk }> {
  if (text.trim().length < 3) throw new AskError("Enter a question with at least three characters.", 400);
  const requester = await getProfile(userId);
  let refined: RefinedAsk;
  try {
    refined = RefinedAsk.parse(await ai.refineAsk(text, requester));
    if (!refined.text.trim()) throw new Error("Empty refined question");
  } catch (error) {
    if (error instanceof AskBlockedError) throw error; // 422 with a message for the screen; nothing is saved
    throw new AskError("Question refinement is unavailable. Try again.", 503);
  }

  const askId = randomUUID();
  try {
    await db().insert(asks).values({ id: askId, userId, rawText: text, refined });
  } catch {
    throw new AskError("Ask storage is unavailable. The save could not be confirmed.", 503);
  }
  await registerSavedAsk(askId, userId, refined.text);
  warmFirstMatch(userId, askId);
  return { askId, refined };
}

/** One of the caller's asks; someone else's ask is reported as missing (404). */
export async function getAsk(userId: string, askId: string): Promise<Ask> {
  let row: typeof asks.$inferSelect | undefined;
  try {
    [row] = await db().select().from(asks).where(and(eq(asks.id, askId), eq(asks.userId, userId))).limit(1);
  } catch {
    throw new AskError("Ask storage is unavailable. Try again.", 503);
  }
  if (!row) throw new AskError("Ask not found.", 404);
  try {
    return Ask.parse({ ...row, createdAt: row.createdAt.toISOString() });
  } catch {
    throw new AskError("Stored ask is invalid.", 503);
  }
}

export async function matchAsk(userId: string, askId: string, query?: string): Promise<MatchResult[]> {
  const ask = await getAsk(userId, askId);

  const [requester, { excludeIds: rejectedIds, hiddenBelowRank }, excludedPeople, , requested] = await Promise.all([
    getProfile(userId),
    getExclusions(askId),
    Promise.resolve(db().select({ id: users.id }).from(users)
      .where(and(eq(users.githubEvidencePending, true), isNotNull(users.filters)))
      // An attendee's active rejection also hides that attendee from the rejected person's matches.
      .union(db().select({ id: asks.userId }).from(asks)
        .innerJoin(rejections, eq(rejections.askId, asks.id))
        .where(and(eq(rejections.personId, userId), eq(asks.status, "open"), eq(asks.softBlocker, true)))))
      .catch(() => { throw new AskError("Matching is unavailable. Try again with the same ask ID.", 503); }),
    // Replaying the saved ID repairs search without another ask or AI call; failure must not block results.
    ask.status === "open" && ask.refined ? registerSavedAsk(ask.id, ask.userId, ask.refined.text) : undefined,
    Promise.resolve(db().select({ id: requests.toPersonId }).from(requests).where(eq(requests.askId, askId)))
      .catch(() => { throw new AskError("Matching is unavailable. Try again with the same ask ID.", 503); }),
  ]);
  try {
    const matches = await runMatch({
      ask, requester, query,
      excludeIds: excludedPeople.map(person => person.id),
      // Ranked, then left out: whoever this ask already passed on (while the blocker is on) or sent a
      // request to. Ranking them keeps everyone else's rank, so the batch cutoff means the same place.
      hideIds: [...(ask.softBlocker ? rejectedIds : []), ...requested.map(person => person.id)],
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
