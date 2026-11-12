/**
 * People who signed in with Google have no GitHub handle (githubLogin: null).
 * Main's fake has no such person yet, so these use made-up API replies, as
 * matches.spec.ts does for data the fake can't reach. Once the enrichment
 * contract lands, its u_demo_researcher fixture covers this end to end.
 */
import { expect, test, type Page } from "@playwright/test";

const ME = "p_003";
const ASK = "made-up-no-github";
const AFTER_SUBMIT = 15_000;

const person = (id: string, name: string, githubLogin: string | null) => ({
  id, name, githubLogin, bio: "", languages: ["Go"], organisations: [],
  filters: { country: "US", rorId: null, hiring: true }, workplaceName: null, badgeColour: "mint", synthetic: false, freeTimes: [],
});
const noGitHub = person("x_google", "Grace Example", null);
const withGitHub = person("x_github", "Linus Example", "linus-example");

const match = (p: ReturnType<typeof person>, rank: number) =>
  ({ person: p, highlights: [], evidence: [], badges: [], mutual: false, explanation: `Why ${p.name}`, score: 1, rank });
const request = (p: ReturnType<typeof person>) => ({
  id: `r-${p.id}`, askId: ASK, fromUserId: ME, toPersonId: p.id, question: "How do I tune the scheduler?", minutes: 5,
  status: "sent", reply: null, slot: null, createdAt: "2026-11-05T12:00:00Z", type: "knowledge", person: p,
});
const ask = (status: "open" | "resolved") =>
  ({ id: ASK, userId: ME, rawText: "q", refined: null, status, softBlocker: true, createdAt: "2026-11-05T12:00:00Z" });

const list = (page: Page) => page.getByRole("region", { name: "Matches" });

async function openAsk(page: Page, matches: unknown[], sent: unknown[]) {
  await page.setExtraHTTPHeaders({ "x-demo-user": ME });
  await page.route(`**/api/asks/${ASK}`, (route) => route.fulfill({ json: ask("open") }));
  await page.route(`**/api/asks/${ASK}/resolve`, (route) => route.fulfill({ json: ask("resolved") }));
  await page.route("**/api/match", (route) => route.fulfill({ json: matches }));
  await page.route("**/api/requests/sent", (route) => route.fulfill({ json: sent }));
  await page.goto(`/matches?ask=${ASK}`);
  await expect(list(page).locator("button[aria-expanded]").first()).toBeVisible({ timeout: AFTER_SUBMIT });
}

async function markAnswered(page: Page) {
  await page.getByRole("button", { name: "Mark as answered" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Marked as answered");
}

test.describe("people without GitHub", () => {
  test("a match without a handle shows no @handle and no GitHub link", async ({ page }) => {
    await openAsk(page, [match(noGitHub, 0)], []);
    const row = list(page).locator("button[aria-expanded]").first();
    await expect(row).toContainText("Grace Example");
    await expect(row).not.toContainText("@");
    await row.click();
    const details = list(page).getByRole("region");
    await expect(details.getByRole("heading", { level: 2 })).toHaveText("Grace Example");
    await expect(details.getByRole("link", { name: /on GitHub/ })).toHaveCount(0);
    await expect(details).not.toContainText("@");
  });

  test("resolving an ask sent only to people without handles leaves out Stay in touch", async ({ page }) => {
    await openAsk(page, [match(noGitHub, 0)], [request(noGitHub)]);
    await markAnswered(page);
    await expect(page.getByRole("heading", { name: "Stay in touch" })).toHaveCount(0);
  });

  test("Stay in touch lists only the people who have a GitHub", async ({ page }) => {
    await openAsk(page, [match(withGitHub, 0), match(noGitHub, 1)], [request(withGitHub), request(noGitHub)]);
    await markAnswered(page);
    const stayInTouch = page.getByRole("region", { name: "Stay in touch" });
    await expect(stayInTouch.getByRole("link")).toHaveCount(1);
    await expect(stayInTouch.getByRole("link", { name: /Linus Example.*@linus-example on GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/linus-example",
    );
    await expect(stayInTouch).not.toContainText("Grace Example");
  });

  test("a request from someone without a handle shows their badge with no GitHub link", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-demo-user": ME });
    const incoming = { ...request(noGitHub), fromUserId: noGitHub.id, toPersonId: ME };
    await page.route("**/api/inbox", (route) => route.fulfill({ json: [incoming] }));
    await page.goto("/inbox");
    const card = page.locator(`article[aria-labelledby="req-${incoming.id}-q"]`);
    await expect(card).toContainText("Grace Example");
    await expect(card.getByRole("link", { name: /on GitHub/ })).toHaveCount(0);
    await expect(card).not.toContainText("@");
  });

  test("an agreed request with someone without a handle shows their contact details, still with no GitHub", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-demo-user": ME });
    const contact = { email: "grace@example.com", phone: null };
    const incoming = { ...request(noGitHub), id: "r-in-agreed", fromUserId: noGitHub.id, toPersonId: ME, status: "accepted", contact };
    const sent = { ...request(noGitHub), id: "r-out-agreed", status: "accepted", contact };
    await page.route("**/api/inbox", (route) => route.fulfill({ json: [incoming] }));
    await page.route("**/api/requests/sent", (route) => route.fulfill({ json: [sent] }));
    await page.goto("/inbox");
    const links = page.getByRole("link", { name: "grace@example.com" });
    await expect(links.first()).toBeVisible();
    for (const link of await links.all()) await expect(link).toHaveAttribute("href", "mailto:grace@example.com");
    await expect(page.getByText("Contact Grace Example").first()).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: /on GitHub/ })).toHaveCount(0);
    expect(await page.getByRole("main").innerText()).not.toMatch(/(^|\s)@[\w-]/); // no @handle; the email's @ is fine
  });

  test("a meeting with someone without a handle shows no GitHub", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-demo-user": ME });
    const booked = { ...request(noGitHub), id: "r-meeting", status: "scheduled", slot: { start: "2026-11-12T09:00:00Z", end: "2026-11-12T09:05:00Z" }, contact: null };
    await page.route("**/api/inbox", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/requests/sent", (route) => route.fulfill({ json: [booked] }));
    await page.goto("/meetings");
    const meeting = page.getByRole("main").getByRole("article");
    await expect(meeting).toContainText("Grace Example");
    await expect(meeting.getByRole("link", { name: /on GitHub/ })).toHaveCount(0);
    await expect(meeting).not.toContainText("@");
  });
});
