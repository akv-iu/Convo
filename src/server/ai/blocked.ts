/**
 * An ask that moderation flags is neither rewritten nor saved. The API turns
 * this into a 422 whose message the ask screen can show as it is.
 */
export class AskBlockedError extends Error {
  readonly status = 422;
  constructor() {
    super("This question can't be sent because it looks offensive or unsafe. Please rephrase it.");
  }
}
