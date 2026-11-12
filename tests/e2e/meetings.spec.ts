/**
 * The Meetings tab: booked meetings from both sides, soonest first. Replies are made up, as
 * no-github.spec.ts does, so the list doesn't depend on other tests' requests.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ME = "p_003";

const person = (id: string, name: string) => ({
  id, name, githubLogin: id, bio: "", languages: ["Go"], organisations: [],
  filters: { country: "US", rorId: null, hiring: true }, workplaceName: null, badgeColour: "mint", synthetic: false, freeTimes: [],
});
const view = (id: string, who: ReturnType<typeof person>, question: string, status: string, start: string | null, contact: unknown = null) => ({
  id, askId: "ask", fromUserId: ME, toPersonId: who.id, question, minutes: 5, status, reply: null,
  slot: start ? { start, end: start.replace(/:00:00Z$/, ":05:00Z") } : null, createdAt: "2026-11-05T12:00:00Z", type: "knowledge", person: who, contact,
});

async function openMeetings(page: Page, inbox: unknown, sent: unknown) {
  await page.setExtraHTTPHeaders({ "x-demo-user": ME });
  await page.route("**/api/inbox", (route) => (typeof inbox === "number" ? route.fulfill({ status: inbox, json: { error: "Unavailable" } }) : route.fulfill({ json: inbox })));
  await page.route("**/api/requests/sent", (route) => route.fulfill({ json: sent }));
  await page.goto("/meetings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meetings");
}

test.describe("meetings", () => {
  test("lists booked meetings from both sides, soonest first, with contact details and Add to calendar", async ({ page }) => {
    const ada = person("ada", "Ada Example");
    const linus = person("linus", "Linus Example");
    await openMeetings(
      page,
      [
        view("in-late", ada, "Accepted later question?", "scheduled", "2026-11-12T15:00:00Z", { email: "ada@example.com", phone: null }),
        view("in-open", ada, "Not booked yet?", "accepted", null),
      ],
      [view("out-early", linus, "Sent earlier question?", "scheduled", "2026-11-12T09:00:00Z")],
    );
    const meetings = page.getByRole("main").getByRole("article");
    await expect(meetings).toHaveCount(2); // the accepted one with no time isn't a meeting
    await expect(meetings.nth(0)).toContainText("Sent earlier question?");
    await expect(meetings.nth(0)).toContainText("With (you asked)");
    await expect(meetings.nth(1)).toContainText("Accepted later question?");
    await expect(meetings.nth(1)).toContainText("With (they asked)");
    await expect(meetings.nth(1).getByRole("link", { name: "ada@example.com" })).toHaveAttribute("href", "mailto:ada@example.com");

    // Add to calendar isn't built yet: it says so, out loud too.
    await meetings.nth(0).getByRole("button", { name: /to your calendar$/ }).click();
    await expect(meetings.nth(0).getByRole("status").filter({ hasText: "Coming soon" })).toBeVisible();
    await expect(meetings.nth(1).getByRole("status").filter({ hasText: "Coming soon" })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  });

  test("with nothing booked, it says so and points to your requests", async ({ page }) => {
    await openMeetings(page, [], []);
    await expect(page.getByRole("heading", { name: "No meetings booked yet" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Go to your requests" })).toHaveAttribute("href", "/inbox");
  });

  test("a failed load says so, and Try again loads them", async ({ page }) => {
    await openMeetings(page, 503, []);
    await expect(page.getByRole("alert").filter({ hasText: "Your meetings didn't load." })).toBeVisible();
    await page.unroute("**/api/inbox");
    await page.route("**/api/inbox", (route) => route.fulfill({ json: [] }));
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "No meetings booked yet" })).toBeVisible();
  });
});
