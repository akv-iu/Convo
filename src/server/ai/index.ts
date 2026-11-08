/**
 * AI interface (B1). The real version (openai.ts) calls OpenAI with
 * JSON-schema responses and caches by input hash in the ai_cache table. The
 * canned version is used by the fake API and when FAKES includes "ai".
 */
import { config } from "@/server/config";
import type { Person, RefinedAsk } from "@/contracts/types";
import type { Candidate } from "@/server/search";
import { cannedAi } from "./canned";
import { openAi } from "./openai";

export { AskBlockedError } from "./blocked";

export interface AiService {
  /**
   * Make a vague ask specific and answerable in a short conversation; classify it; suggest a length.
   * Throws AskBlockedError (422) for an offensive ask.
   */
  refineAsk(rawText: string, requester: Person): Promise<RefinedAsk>;
  /**
   * Moderation only, for an ask saved as written: resolves if it may be saved, throws
   * AskBlockedError (422) if it's flagged, and rethrows if the check itself fails.
   */
  moderate(text: string): Promise<void>;
  /** ONE batched call: a "why this person" line per candidate, from their highlights. */
  explain(ask: RefinedAsk, candidates: Candidate[]): Promise<string[]>;
}

export const ai: AiService = config.fakeAi || config.fakeApi ? cannedAi : openAi;
