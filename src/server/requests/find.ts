import { inArray } from "drizzle-orm";
import { db } from "../../../db";
import { users } from "../../../db/schema";
import type { CardPerson, Person } from "@/contracts/types";
import { findIn } from "@/server/pipeline/find";
import { toPerson } from "@/server/profile/service";
import { search } from "@/server/search";

class FindError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** GET /api/find: everyone in search, with signed-up people as they saved themselves. */
export async function findPeople(userId: string, query: string): Promise<CardPerson[]> {
  if (!query.trim()) return [];
  let everyone: Person[];
  let accounts: Map<string, Person>;
  try {
    everyone = await search.listPeople();
    const ids = everyone.map((p) => p.id);
    const rows = ids.length ? await db().select().from(users).where(inArray(users.id, ids)) : [];
    accounts = new Map(rows.filter((row) => row.filters !== null).map((row) => [row.id, toPerson(row)]));
  } catch {
    throw new FindError("The person finder is unavailable just now. Try again.", 503);
  }
  return findIn(everyone, accounts, query, userId);
}
