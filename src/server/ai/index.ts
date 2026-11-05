/**
 * AI interface (B1). The real version calls OpenAI with JSON-schema
 * responses and caches by input hash in the ai_cache table. The canned
 * version is used by the fake API and when FAKES includes "ai".
 */
import { config } from "@/server/config";
import type { Person, RefinedAsk } from "@/contracts/types";
import type { Candidate } from "@/server/search";
import { cannedAi } from "./canned";

export interface AiService {
  /** Make a vague ask specific and answerable in a short conversation; classify it; suggest a length. */
  refineAsk(rawText: string, requester: Person): Promise<RefinedAsk>;
  /** ONE batched call: a "why this person" line per candidate, from their highlights. */
  explain(ask: RefinedAsk, candidates: Candidate[]): Promise<string[]>;
}

function notImplemented(): never {
  throw new Error("OpenAI is not implemented yet (B1). Set FAKES=ai to use canned replies.");
}

export const openAi: AiService = {
  refineAsk: async () => notImplemented(),
  explain: async () => notImplemented(),
};

export const ai: AiService = config.fakeAi || config.fakeApi ? cannedAi : openAi;
