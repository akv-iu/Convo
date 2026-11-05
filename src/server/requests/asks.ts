import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { asks, rejections } from "../../../db/schema";
import { Ask, RefinedAsk, type MatchResult } from "@/contracts/types";
import { routes } from "@/contracts/routes";
import { getProfile } from "@/server/profile/service";
import { ai } from "@/server/ai";
import { search } from "@/server/search";
import { runMatch } from "@/server/pipeline";
import { config } from "@/server/config";

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
    await search.registerAsk(userId, refined.text);
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
  let rejected: { personId: string; rank: number }[];
  try {
    const rows = await db().select({ personId: rejections.personId, rank: rejections.rank })
      .from(rejections).where(eq(rejections.askId, askId));
    rejected = routes.reject.body.omit({ askId: true }).array().parse(rows);
  } catch {
    throw new AskError("Ask exclusions are unavailable. Try again.", 503);
  }
  const hiddenBelowRank = rejected.length >= config.batchRejectAfter
    ? rejected.reduce((highest, rejection) => Math.max(highest, rejection.rank), 0) : null;
  try {
    return routes.match.response.parse(await runMatch({
      ask, requester, query,
      excludeIds: ask.softBlocker ? rejected.map(({ personId }) => personId) : [],
      hiddenBelowRank,
    }));
  } catch {
    throw new AskError("Matching is unavailable. Try again with the same ask ID.", 503);
  }
}
