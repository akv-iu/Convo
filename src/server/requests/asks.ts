import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { after } from "next/server";
import { db } from "../../../db";
import { asks, rejections, requests, users } from "../../../db/schema";
import { Ask, ProfileVisibility, RefinedAsk, type AskType, type MatchResult, type Person } from "@/contracts/types";
import { ASK_TEXT_MAX, ASK_TEXT_MIN, routes } from "@/contracts/routes";
import { MEETING_MINUTES } from "@/server/ai/minutes";
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
  const refined = await refineOrFail(text, await getProfile(userId));

  const askId = randomUUID();
  try {
    // Set here as well as in the column default, so it doesn't depend on when the migration is applied.
    await db().insert(asks).values({ id: askId, userId, rawText: text, refined, softBlocker: false });
  } catch {
    throw new AskError("Ask storage is unavailable. The save could not be confirmed.", 503);
  }
  await registerSavedAsk(askId, userId, refined.text);
  warmFirstMatch(userId, askId);
  return { askId, refined };
}

/** The AI's sharper question, checked; a flagged ask stays a 422 and any other failure is a sanitized 503. */
async function refineOrFail(text: string, requester: Person): Promise<RefinedAsk> {
  try {
    const refined = RefinedAsk.parse(await ai.refineAsk(text, requester));
    if (!refined.text.trim()) throw new Error("Empty refined question");
    return refined;
  } catch (error) {
    if (error instanceof AskBlockedError) throw error; // 422 with a message for the screen; nothing is saved
    throw new AskError("Question refinement is unavailable. Try again.", 503);
  }
}

/** The routes' own bounds, checked again here for callers that skip the contract. */
function askText(text: string): string {
  const question = text.trim();
  if (question.length < ASK_TEXT_MIN || question.length > ASK_TEXT_MAX) {
    throw new AskError(`Enter a question of ${ASK_TEXT_MIN} to ${ASK_TEXT_MAX} characters.`, 400);
  }
  return question;
}

/**
 * "Sharpen with AI": a suggestion only. Nothing is saved or registered for matching,
 * and no background match starts; the asker may edit it, drop it, or save it with saveAskAsWritten.
 */
export async function previewAsk(userId: string, text: string): Promise<{ refined: RefinedAsk }> {
  const question = askText(text);
  return { refined: await refineOrFail(question, await getProfile(userId)) };
}

/**
 * Save the question exactly as the asker gives it: no AI rewrite. `refined` is set to that same
 * text, so matching never refines it behind the asker's back (runMatch refines only a null `refined`).
 * Moderation still runs; if it can't, the ask is refused rather than saved unchecked.
 */
export async function saveAskAsWritten(
  userId: string,
  body: { text: string; type?: AskType; minutes?: number },
): Promise<{ askId: string; ask: Ask }> {
  const question = askText(body.text);
  await getProfile(userId); // a completed profile, as for refine
  try {
    await ai.moderate(question);
  } catch (error) {
    if (error instanceof AskBlockedError) throw error;
    throw new AskError("The safety check is unavailable, so the question wasn't saved. Try again.", 503);
  }
  const refined: RefinedAsk = { text: question, type: body.type ?? "knowledge", minutes: body.minutes ?? MEETING_MINUTES };
  const askId = randomUUID();
  const createdAt = new Date(); // set here, so the saved row and the response agree without reading it back
  try {
    await db().insert(asks).values({ id: askId, userId, rawText: question, refined, softBlocker: false, createdAt });
  } catch {
    throw new AskError("Ask storage is unavailable. The save could not be confirmed.", 503);
  }
  await registerSavedAsk(askId, userId, question);
  warmFirstMatch(userId, askId);
  return {
    askId,
    ask: { id: askId, userId, rawText: question, refined, status: "open", softBlocker: false, createdAt: createdAt.toISOString() },
  };
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
