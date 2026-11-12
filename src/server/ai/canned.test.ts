import { describe, expect, it } from "vitest";
import { people } from "@/contracts/fixtures";
import { AskBlockedError } from "./blocked";
import { cannedAi } from "./canned";

const refine = (text: string) => cannedAi.refineAsk(text, people[0]);
const wordCount = (text: string) => text.split(/\s+/).length;

describe("cannedAi.moderate", () => {
  it("blocks the test insult and lets anything else through", async () => {
    await expect(cannedAi.moderate("You absolute idiot")).rejects.toBeInstanceOf(AskBlockedError);
    await expect(cannedAi.moderate("How does Raft pick a leader?")).resolves.toBeUndefined();
  });
});

describe("cannedAi.refineAsk", () => {
  it("blocks asks with the test insult, so the 422 screen works with the fake API", async () => {
    await expect(refine("You absolute idiot")).rejects.toBeInstanceOf(AskBlockedError);
    await expect(refine("How does Raft pick a leader?")).resolves.toMatchObject({ type: "knowledge" });
  });

  // Each ask with the technical terms its suggestion must keep.
  const asks: [string, string[]][] = [
    ["how does Raft do the voting thing", ["Raft", "voting"]],
    ["how do i tune postgres autovacuum", ["postgres autovacuum"]],
    ["should I use Kafka or NATS for event sourcing", ["Kafka", "NATS", "event sourcing"]],
    ["what is eBPF", ["eBPF"]],
    ["my otel collector keeps dropping spans under load", ["otel collector", "spans"]],
    ["I want to understand how preemption works in the Kubernetes scheduler", ["preemption", "Kubernetes scheduler"]],
    ["basically k8s networking stuff", ["k8s networking"]],
  ];

  it("turns different asks into different, tidy questions that keep the asker's terms", async () => {
    const texts: string[] = [];
    for (const [raw, terms] of asks) {
      const { text, type, minutes } = await refine(raw);
      expect(type, raw).toBe("knowledge");
      expect(minutes).toBe(5);
      expect(text, raw).toMatch(/^[A-Z].*\?$/);
      expect(text, raw).not.toMatch(/\b(thing|stuff|basically|kinda)\b|\bi\b|\s{2}/);
      for (const term of terms) expect(text, raw).toContain(term);
      expect(wordCount(text), raw).toBeLessThanOrEqual(40);
      texts.push(text);
    }
    expect(new Set(texts).size).toBe(asks.length);
    // Not one stock suffix glued onto every ask: the endings differ too.
    expect(new Set(texts.map((t) => t.split(" ").slice(-4).join(" "))).size).toBeGreaterThan(3);
  });

  it("rewrites vague wording into a specific question rather than echoing it", async () => {
    expect((await refine("how does Raft do the voting thing")).text).toMatch(/^How does Raft handle voting\b/);
    expect((await refine("I want to understand how preemption works in the Kubernetes scheduler")).text)
      .toMatch(/^How does preemption work in the Kubernetes scheduler\b/);
    expect((await refine("Kafka vs Pulsar")).text).toMatch(/Kafka.*Pulsar.*\?$/);
  });

  it("gives the same ask the same suggestion every time", async () => {
    for (const [raw] of asks) expect(await refine(raw)).toEqual(await refine(raw));
  });

  it("keeps the asker's goal for career, hiring and collaboration asks, and asks the other person", async () => {
    const job = await refine("I want a job at Grafana Labs");
    expect(job).toMatchObject({ type: "career", text: expect.stringMatching(/^I want a job at Grafana Labs\. .*\byour?\b.*\?$/) });

    const interview = await refine("How should I prepare for a platform engineering interview at Netflix?");
    expect(interview).toMatchObject({ type: "career", text: expect.stringMatching(/^How should I prepare for a platform engineering interview at Netflix\? .+\?$/) });

    const hire = await refine("hiring SREs who know argo");
    expect(hire).toMatchObject({ type: "hiring", text: expect.stringMatching(/^We're hiring SREs who know argo\. .*\byou.*\?$/) });
    expect(await refine("We're looking for an SRE who has been on call for Loki")).toMatchObject({ type: "hiring" });

    const build = await refine("anyone want to build a Raft visualiser with me");
    expect(build).toMatchObject({ type: "collaboration", text: expect.stringMatching(/^Would you want to build a Raft visualiser with me\? .+\?$/) });
    expect(await refine("Looking for a collaborator to co-author research on gang scheduling for ML training jobs"))
      .toMatchObject({ type: "collaboration", text: expect.stringContaining("gang scheduling for ML training jobs") });
  });
});
