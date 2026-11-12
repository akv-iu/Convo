/**
 * Demo activity for the local fake API (FAKE_DEMO=1), so both sides of a request can be seen alone:
 * - the first time someone opens their requests, two demo attendees have sent them a question;
 * - demo attendees reply to requests sent to them after a short wait: most accept (and their
 *   chosen contact details appear), some answer in a line, a few decline.
 * Everything is made up and lives only in memory.
 */
import { MEETING_MINUTES } from "@/server/ai/minutes";
import { store } from "./store";

/** How long a demo attendee "thinks" before replying to your request. */
const REPLY_AFTER_MS = 15_000;

const INCOMING = [
  {
    question: "How did you get your first role in platform engineering, and what would you do differently?",
    message: "Hi! I'm by the coffee stand all afternoon if you have ten minutes.",
    type: "career" as const,
  },
  {
    question: "What's the safest way you've found to run Postgres migrations in CI without downtime?",
    message: null,
    type: "knowledge" as const,
  },
];

const REPLIES = [
  "Short answer: run it behind a feature flag first, then flip it. Happy to show you how we did it at the break.",
  "I'd start with the official docs' troubleshooting page, it covers most of this. Ping me later if you're stuck.",
];

const hash = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function playDemo(userId: string): void {
  const state = store.get();
  const me = state.people.get(userId);
  if (!me) return;

  if (!state.seeded.has(userId)) {
    state.seeded.add(userId);
    const senders = [...state.people.values()].filter((p) => p.synthetic && p.id !== userId).slice(-2);
    senders.forEach((sender, i) => {
      const item = INCOMING[i % INCOMING.length];
      const askId = crypto.randomUUID();
      const createdAt = new Date(Date.now() - (i + 1) * 7 * 60_000).toISOString();
      state.asks.set(askId, {
        id: askId,
        userId: sender.id,
        rawText: item.question,
        refined: { text: item.question, type: item.type, minutes: MEETING_MINUTES },
        status: "open",
        softBlocker: false,
        createdAt,
      });
      const id = store.nextId("req");
      state.requests.set(id, {
        id, askId, fromUserId: sender.id, toPersonId: userId, question: item.question, message: item.message,
        minutes: MEETING_MINUTES, status: "sent", reply: null, slot: null, createdAt,
      });
    });
  }

  // Replies to what you sent, once they've had time to "read" it.
  for (const request of state.requests.values()) {
    if (request.fromUserId !== userId || request.status !== "sent") continue;
    if (!state.people.get(request.toPersonId)?.synthetic) continue;
    if (Date.now() - Date.parse(request.createdAt) < REPLY_AFTER_MS) continue;
    const roll = hash(request.toPersonId + request.askId) % 10;
    if (roll < 6) request.status = "accepted";
    else if (roll < 9) {
      request.status = "answered";
      request.reply = REPLIES[roll % REPLIES.length];
    } else request.status = "declined";
  }
}
