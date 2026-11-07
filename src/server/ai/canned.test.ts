import { describe, expect, it } from "vitest";
import { people } from "@/contracts/fixtures";
import { AskBlockedError } from "./blocked";
import { cannedAi } from "./canned";

describe("cannedAi.refineAsk", () => {
  it("blocks asks with the test insult, so the 422 screen works with the fake API", async () => {
    await expect(cannedAi.refineAsk("You absolute idiot", people[0])).rejects.toBeInstanceOf(AskBlockedError);
    await expect(cannedAi.refineAsk("How does Raft pick a leader?", people[0])).resolves.toMatchObject({ type: "knowledge" });
  });
});
