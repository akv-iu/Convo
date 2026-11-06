import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { asks } from "../../../db/schema";
import { Ask } from "@/contracts/types";
import { getProfile } from "@/server/profile/service";
import { search } from "@/server/search";

class AskLifecycleError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function resolveAsk(userId: string, askId: string): Promise<Ask> {
  let ask: Ask;
  try {
    const [row] = await db().update(asks).set({ status: "resolved" })
      .where(and(eq(asks.id, askId), eq(asks.userId, userId))).returning();
    if (!row) throw new AskLifecycleError("Ask not found.", 404);
    ask = Ask.parse({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (error) {
    if (error instanceof AskLifecycleError) throw error;
    throw new AskLifecycleError("Ask storage is unavailable. Retry resolving the same ask ID.", 503);
  }
  try {
    await search.removeAsk(askId);
  } catch {
    throw new AskLifecycleError("Ask resolved, but search update failed. Retry resolving the same ask ID.", 503);
  }
  return ask;
}

export async function lookingForMe(userId: string): Promise<{ count: number }> {
  const person = await getProfile(userId);
  try {
    const ids = z.array(z.string().min(1)).parse(await search.whoIsLookingFor(person));
    return { count: new Set(ids.filter(id => id !== userId)).size };
  } catch {
    throw new AskLifecycleError("The looking-for-you count is unavailable. Try again.", 503);
  }
}
