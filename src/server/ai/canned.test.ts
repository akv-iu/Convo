import { describe, expect, it } from "vitest";
import { people } from "@/contracts/fixtures";
import { AskBlockedError } from "./blocked";
import { cannedAi } from "./canned";

describe("cannedAi.moderate", () => {
  it("blocks the test insult and lets anything else through", async () => {
    await expect(cannedAi.moderate("You absolute idiot")).rejects.toBeInstanceOf(AskBlockedError);
    await expect(cannedAi.moderate("How does Raft pick a leader?")).resolves.toBeUndefined();
  });
});

describe("cannedAi.refineAsk", () => {
  it("blocks asks with the test insult, so the 422 screen works with the fake API", async () => {
    await expect(cannedAi.refineAsk("You absolute idiot", people[0])).rejects.toBeInstanceOf(AskBlockedError);
    await expect(cannedAi.refineAsk("How does Raft pick a leader?", people[0])).resolves.toMatchObject({ type: "knowledge" });
  });
});
