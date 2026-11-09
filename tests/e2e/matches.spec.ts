import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * A2 steps 1 and 2: the match list, on the fake API. Each test
 * makes its own ask, so passes and requests never leak between tests, and
 * checks what the server stored (its matches and the receiver's inbox).
 */

const AFTER_SUBMIT = 15_000;
const ME = "p_003";

type Match = {
  person: { id: string; name: string; synthetic: boolean; githubLogin: string };
  rank: number;
  explanation: string;
  highlights: string[];
  evidence: { kind: string; title: string; url?: string }[];
};

const passButton = (page: Page) => page.getByRole("button", { name: /^Pass$/ });
const sendButton = (page: Page) => page.getByRole("button", { name: /^Send request/ });
const list = (page: Page) => page.getByRole("region", { name: "Matches" });
/** The open person's full profile (one at a time). */
const card = (page: Page) => list(page).getByRole("region");
/** The rows' open/close buttons, in rank order. */
const rows = (page: Page) => list(page).locator("button[aria-expanded]");
const isPass = (r: Request) => r.url().endsWith("/api/rejections") && r.method() === "POST";
const isSend = (r: Request) => r.url().endsWith("/api/requests") && r.method() === "POST";
const alertWithText = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

async function newAsk(page: Page, text = "how does the Kubernetes scheduler do preemption") {
  const res = await page.request.post("/api/refine", { headers: { "x-demo-user": ME }, data: { text } });
  expect(res.ok()).toBe(true);
  return (await res.json()).askId as string;
}

/** New asks start with "Keep people I pass on hidden" off; tests about hiding turn it on first. */
async function hidePassed(page: Page, askId: string) {
  const res = await page.request.put("/api/soft-blocker", { headers: { "x-demo-user": ME }, data: { askId, enabled: true } });
  expect(res.ok()).toBe(true);
}

async function serverMatches(page: Page, askId: string): Promise<Match[]> {
  const res = await page.request.post("/api/match", { headers: { "x-demo-user": ME }, data: { askId } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as Match[]).sort((a, b) => a.rank - b.rank);
}

/** Opens the matches and, when there are any, the first person's profile. */
async function open(page: Page, askId: string) {
  await page.setExtraHTTPHeaders({ "x-demo-user": ME });
  await page.goto(`/matches?ask=${askId}`);
  const first = rows(page).first();
  // Whichever the list settles on: a person, the end panel (no one, or everyone answered), or an error.
  const settled = first.or(list(page).getByRole("heading", { level: 2 })).or(list(page).getByRole("alert"));
  await expect(settled.first()).toBeVisible({ timeout: AFTER_SUBMIT });
  if (await first.isVisible()) await first.click();
}
const askJson = (askId: string, softBlocker: boolean) =>
  ({ id: askId, userId: ME, rawText: "q", refined: null, status: "open", softBlocker, createdAt: "2026-11-05T12:00:00Z" });
/** A saved ask for tests that mock the matches of a made-up ask (the switch shows only once its setting is known). */
async function savedAsk(page: Page, askId: string, softBlocker = true) {
  await page.route(`**/api/asks/${askId}`, (route) => route.fulfill({ json: askJson(askId, softBlocker) }));
}

/** Made-up results for screens the fake's data can't reach (many people, hidden fields). */
function fakeMatches(n: number) {
  return Array.from({ length: n }, (_, rank) => ({
    person: {
      id: `x_${rank}`,
      name: `Person ${rank + 1}`,
      githubLogin: `person${rank + 1}`,
      bio: "",
      languages: ["Go"],
      organisations: [],
      filters: { country: rank === 0 ? null : "US", rorId: null, hiring: rank === 0 ? null : true },
      workplaceName: null,
      badgeColour: "mint",
      avatar: rank === 1 ? "star" : null,
      synthetic: rank % 2 === 1,
      freeTimes: [],
    },
    highlights: ["Raft <em>leader election</em>"],
    evidence:
      rank === 0
        ? [
            { kind: "repo", title: "etcd-io/raft", url: "https://github.com/etcd-io/raft" },
            { kind: "talk", title: "Raft at KubeCon" },
          ]
        : [],
    badges: rank === 0 ? [] : ["hiring", "US"],
    mutual: rank === 1,
    explanation: `Why person ${rank + 1}`,
    score: 1,
    rank,
  }));
}

test.describe("match list (A2 steps 1-2)", () => {
  test("Send on the ask screen opens the list, best match first, with the question", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-demo-user": ME });
    await page.goto("/ask");
    await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("how does the Kubernetes scheduler do preemption");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("People who can help", { timeout: AFTER_SUBMIT });
    await rows(page).first().click();
    await expect(page.getByText(/Your question: .how does the Kubernetes scheduler do preemption./)).toBeVisible(); // as written

    const askId = new URL(page.url()).searchParams.get("ask")!;
    const expected = await serverMatches(page, askId);
    expect(expected.length).toBeGreaterThan(0);
    const first = expected[0];
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(first.person.name);
    await expect(page.getByText(`${expected.length} ${expected.length === 1 ? "person" : "people"} found`)).toBeVisible();
    await expect(card(page)).toContainText(first.explanation);
    if (first.person.synthetic) await expect(card(page)).toContainText("Synthetic profile");
  });

  test("Send request sends the question to that person, and they get it", async ({ page }) => {
    const askId = await newAsk(page);
    const [first, second] = await serverMatches(page, askId);
    await open(page, askId);
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(first.person.name);

    const sending = page.waitForRequest(isSend);
    await sendButton(page).click();
    expect((await sending).postDataJSON()).toEqual({ askId, toPersonId: first.person.id });
    await expect(page.getByRole("status").filter({ hasText: "Request sent" })).toHaveText(`Request sent to ${first.person.name}.`);
    if (second) await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(second.person.name);

    const inbox = await page.request.get("/api/inbox", { headers: { "x-demo-user": first.person.id } });
    const received = (await inbox.json()) as { askId: string; fromUserId: string; status: string }[];
    expect(received.some((r) => r.askId === askId && r.fromUserId === ME && r.status === "sent")).toBe(true);
  });

  test("Pass saves the pass with the card's rank, and with hiding on that person drops out of the matches", async ({ page }) => {
    const askId = await newAsk(page);
    await hidePassed(page, askId);
    const [first] = await serverMatches(page, askId);
    await open(page, askId);
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(first.person.name);
    const passing = page.waitForRequest(isPass);
    await passButton(page).click();
    expect((await passing).postDataJSON()).toEqual({ askId, personId: first.person.id, rank: first.rank });
    await expect(page.getByRole("status").filter({ hasText: "Passed" })).toHaveText(`Passed on ${first.person.name}.`);
    const after = await serverMatches(page, askId);
    expect(after.map((m) => m.person.id)).not.toContain(first.person.id);
  });

  test("a short list: rows open one at a time, and work with the keyboard", async ({ page, isMobile }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(3) }));
    await page.setExtraHTTPHeaders({ "x-demo-user": ME });
    await page.goto("/matches?ask=made-up");
    await expect(page.getByText("3 people found")).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
    await expect(card(page)).toHaveCount(0); // condensed until you pick someone
    await expect(rows(page).nth(1)).toContainText("Person 2");
    await expect(rows(page).nth(1)).toContainText("Why person 2");
    await rows(page).nth(1).click();
    await expect(rows(page).nth(1)).toHaveAttribute("aria-expanded", "true");
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    await rows(page).nth(0).click(); // opening another closes the first
    await expect(card(page)).toHaveCount(1);
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 1");
    if (isMobile) return;
    await page.route("**/api/requests", (route) => route.fulfill({ json: { id: "r1" } }));
    await sendButton(page).focus();
    await page.keyboard.press("Enter");
    // The next person opens, and focus moves to their row.
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    await expect(rows(page).nth(1)).toBeFocused();
    await expect(rows(page).nth(0)).toContainText("Request sent");
  });

  test("with no close match, the list says these are the nearest people, at most three", async ({ page }) => {
    // The fake API rates everyone a partial fit for "[demo:nearest]", as the model does when no one fits strongly.
    const askId = await newAsk(page, "how does the Kubernetes scheduler do preemption [demo:nearest]");
    await open(page, askId);
    await expect(page.getByText(/^No close match\. The (\d nearest people|nearest person)$/)).toBeVisible();
    await expect(page.getByText(/^No one here works on exactly this\./)).toBeVisible();
    expect(await rows(page).count()).toBeLessThanOrEqual(3);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, colorScheme).toEqual([]);
    }
  });

  test("an ordinary ask counts the people found, with no nearest note", async ({ page }) => {
    await open(page, await newAsk(page));
    await expect(page.getByText(/^\d+ (people|person) found$/)).toBeVisible();
    await expect(page.getByText(/^No close match/)).toHaveCount(0);
  });

  test("a card shows evidence highlights, the mutual marker, and hides fields the person hid", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(3) }));
    await open(page, "made-up");
    const c = card(page);
    await expect(c.getByRole("heading", { level: 2 })).toHaveText("Person 1");
    await expect(c.locator("mark")).toHaveText("leader election");
    await expect(c).not.toContainText("Not hiring"); // hidden hiring (null) is not "not hiring"
    await expect(c).not.toContainText("United States");
    await page.route("**/api/rejections", (route) => route.fulfill({ json: { rejections: 1, hiddenBelowRank: null } }));
    await passButton(page).click();
    await expect(c.getByRole("heading", { level: 2 })).toHaveText("Person 2");
    await expect(c).toContainText("Synthetic profile");
    await expect(c).toContainText("Looking for someone like you too");
    await expect(c).toContainText("Hiring");
    await expect(c).toContainText("United States");
  });

  test("rows and open profiles show each person's picture, or their initials", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
    await open(page, "made-up");
    await expect(rows(page).nth(0).locator("[data-avatar]")).toHaveAttribute("data-avatar", "initials");
    await expect(rows(page).nth(0).locator("[data-avatar]")).toHaveText("P1");
    await expect(rows(page).nth(1).locator("[data-avatar]")).toHaveAttribute("data-avatar", "star");
    await expect(card(page).locator("[data-avatar]")).toHaveAttribute("data-avatar", "initials");
    await rows(page).nth(1).click();
    await expect(card(page).locator("[data-avatar]")).toHaveAttribute("data-avatar", "star");
  });

  test("the open profile lists projects and papers, linking out safely", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
    await open(page, "made-up");
    const works = card(page).getByRole("list", { name: "Person 1's projects and papers" });
    await expect(works.getByRole("listitem")).toHaveCount(2);
    await expect(works.getByRole("listitem").nth(0)).toContainText("Repository");
    const link = works.getByRole("link", { name: "etcd-io/raft (opens in a new tab)" });
    await expect(link).toHaveAttribute("href", "https://github.com/etcd-io/raft");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // An item without a link keeps its title, shown as plain text.
    await expect(works.getByRole("listitem").nth(1)).toContainText("Talk");
    await expect(works.getByRole("listitem").nth(1).getByRole("link")).toHaveCount(0);
    // Someone with no evidence has no empty section.
    await rows(page).nth(1).click();
    await expect(card(page).getByText("Projects and papers")).toHaveCount(0);
  });

  test("evidence links come from the server's matches", async ({ page }) => {
    const askId = await newAsk(page);
    const top = (await serverMatches(page, askId)).find((m) => m.evidence.some((e) => e.url));
    expect(top).toBeTruthy();
    await open(page, askId);
    const row = rows(page).filter({ hasText: top!.person.name });
    if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
    await expect(card(page).getByRole("link", { name: /\(opens in a new tab\)$/ }).filter({ hasNotText: "on GitHub" }).first())
      .toHaveAttribute("href", /^https:\/\//);
  });

  test("after the third pass, people ranked below are hidden as the server says", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(6) }));
    // As the server does: after three passes the cutoff is the highest rank passed on.
    const passed: number[] = [];
    await page.route("**/api/rejections", (route) => {
      passed.push(route.request().postDataJSON().rank);
      return route.fulfill({ json: { rejections: passed.length, hiddenBelowRank: passed.length >= 3 ? Math.max(...passed) : null } });
    });
    await open(page, "made-up");
    for (let i = 1; i <= 3; i++) {
      await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(`Person ${i}`);
      await passButton(page).click();
    }
    // Cutoff 2 keeps only ranks 0-1, already seen, so the deck ends and says why.
    await expect(page.getByRole("heading", { name: "That's everyone for now" })).toBeVisible();
    await expect(page.getByText("You've passed on three people, so Lanyard hid everyone ranked below them.")).toBeVisible();
    expect(passed).toEqual([0, 1, 2]);
  });

  test("a cutoff above the current card keeps the cards before it", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(6) }));
    // Earlier visits already passed on ranks 3 and 4 (e.g. before See them again); this is the third pass.
    const passed = [3, 4];
    await page.route("**/api/rejections", (route) => {
      passed.push(route.request().postDataJSON().rank);
      return route.fulfill({ json: { rejections: passed.length, hiddenBelowRank: Math.max(...passed) } });
    });
    await open(page, "made-up");
    await passButton(page).click();
    // Cutoff 4 keeps ranks 0-3, and Person 1 (passed) leaves: Person 2 opens, 3 people left.
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    await expect(page.getByText("3 people found")).toBeVisible();
    await expect(page.getByText("You've passed on three people, so Lanyard hid everyone ranked below them.")).toBeVisible();
  });

  test("pressing Search again with the same words reloads instead of hanging", async ({ page }) => {
    let loads = 0;
    await page.route("**/api/match", (route) => {
      loads++;
      return route.fulfill({ json: fakeMatches(2) });
    });
    await open(page, "made-up");
    await expect(card(page)).toBeVisible();
    await page.getByRole("button", { name: "Search", exact: true }).click(); // empty box, same as now
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole("searchbox", { name: "Narrow the list" }).fill("Go");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect.poll(() => loads).toBe(4);
  });

  test("a failed pass is never retried by itself, and Refresh matches reloads", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
    let passes = 0;
    await page.route("**/api/rejections", (route) => {
      passes++;
      return route.fulfill({ status: 503, json: { error: "Rejection saved, but the count could not be read. Do not resubmit." } });
    });
    await open(page, "made-up");
    await passButton(page).click();
    await expect(alertWithText(page)).toContainText("Do not resubmit.");
    // The pass may have been saved, and each one counts: Pass and Send stay off on this card.
    await expect(passButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(sendButton(page)).toHaveAttribute("aria-disabled", "true");
    // A person can still press them (they stay focusable); the presses must do nothing.
    await passButton(page).click({ force: true });
    await sendButton(page).click({ force: true });
    await page.getByRole("heading", { level: 1 }).click();
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(500);
    expect(passes).toBe(1);
    const reloading = page.waitForRequest((r) => r.url().endsWith("/api/match"));
    await page.getByRole("button", { name: "Refresh matches" }).click();
    await reloading;
    await expect(rows(page).first()).toContainText("Person 1");
    await rows(page).first().click();
    await expect(passButton(page)).not.toHaveAttribute("aria-disabled", "true");
  });

  test("Search waits while a pass is saving, so the save can't land on a new deck", async ({ page }) => {
    let loads = 0;
    await page.route("**/api/match", (route) => {
      loads++;
      return route.fulfill({ json: fakeMatches(3) });
    });
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/api/rejections", async (route) => {
      await held;
      return route.fulfill({ json: { rejections: 1, hiddenBelowRank: null } });
    });
    await open(page, "made-up");
    await expect(card(page)).toBeVisible();
    await passButton(page).click();
    const search = page.getByRole("button", { name: "Search", exact: true });
    await expect(search).toHaveAttribute("aria-disabled", "true");
    await search.click({ force: true });
    release();
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    expect(loads).toBe(1);
    await expect(search).not.toHaveAttribute("aria-disabled", "true");
  });

  test("Show everyone looks unavailable and waits while a pass is saving", async ({ page }) => {
    let loads = 0;
    await page.route("**/api/match", (route) => {
      loads++;
      return route.fulfill({ json: fakeMatches(3) });
    });
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/api/rejections", async (route) => {
      await held;
      return route.fulfill({ json: { rejections: 1, hiddenBelowRank: null } });
    });
    await open(page, "made-up");
    await page.getByRole("searchbox", { name: "Narrow the list" }).fill("Go");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText(/Showing people for .Go./)).toBeVisible();
    await rows(page).first().click();
    await expect(card(page)).toBeVisible();
    await passButton(page).click();
    const showAll = page.getByRole("button", { name: "Show everyone" });
    await expect(showAll).toHaveAttribute("aria-disabled", "true");
    await showAll.click({ force: true });
    release();
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    await expect(showAll).not.toHaveAttribute("aria-disabled", "true");
    expect(loads).toBe(2);
  });

  test("after Pass or Send, keyboard focus moves to the next person's row", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(3) }));
    await page.route("**/api/rejections", (route) => route.fulfill({ json: { rejections: 1, hiddenBelowRank: null } }));
    await page.route("**/api/requests", (route) => route.fulfill({ json: { id: "r1" } }));
    await open(page, "made-up");
    await passButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    await expect(rows(page).first()).toBeFocused(); // Person 1 left the list, so Person 2 is first
    await sendButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 3");
    await expect(rows(page).nth(1)).toBeFocused();
  });

  test("passing everyone on a short list ends with \"That's everyone\" and focus on it", async ({ page, isMobile }) => {
    // Two people, no sends and no cutoff (fewer than three passes).
    await savedAsk(page, "made-up");
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
    await page.route("**/api/rejections", (route) => route.fulfill({ json: { rejections: 1, hiddenBelowRank: null } }));
    await open(page, "made-up");
    for (const name of ["Person 1", "Person 2"]) {
      await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(name);
      if (isMobile) await passButton(page).click();
      else {
        await passButton(page).focus();
        await page.keyboard.press("Enter");
      }
    }
    await expect(rows(page)).toHaveCount(0);
    const done = list(page).getByRole("heading", { level: 2 });
    await expect(done).toHaveText("That's everyone for now");
    await expect(list(page)).toContainText("You passed on everyone Lanyard found.");
    // With the switch on, a reload brings no one back, so the panel points at the switch instead.
    await expect(list(page)).toContainText("turn off “Keep people I pass on hidden”");
    await expect(page.getByRole("button", { name: "See them again" })).toHaveCount(0);
    // The Pass button went with the list; the keyboard lands on the end panel, not the page body.
    if (!isMobile) await expect(done).toBeFocused();
  });

  test("with hiding off (the default), a pass marks the person Passed and they stay; passing everyone ends the list", async ({ page, isMobile }) => {
    await savedAsk(page, "made-up", false);
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
    await page.route("**/api/rejections", (route) => route.fulfill({ json: { rejections: 1, hiddenBelowRank: null } }));
    await open(page, "made-up");
    await expect(page.getByRole("switch", { name: "Keep people I pass on hidden" })).not.toBeChecked();
    await passButton(page).click();
    // Person 1 stays, marked, and the next person opens.
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(0)).toContainText("Passed");
    if (!isMobile) await expect(rows(page).nth(1)).toBeFocused();
    // Reopening a passed person says so instead of offering Pass and Send again.
    await rows(page).nth(0).click();
    await expect(card(page)).toContainText("You passed on Person 1.");
    await expect(passButton(page)).toHaveCount(0);
    await rows(page).nth(1).click();
    await passButton(page).click();
    // Everyone is passed: the end panel shows below the still-listed people, with no hint to turn the switch off.
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(1)).toContainText("Passed");
    await expect(list(page).getByRole("heading", { level: 2, name: "That's everyone for now" })).toBeVisible();
    await expect(list(page)).toContainText("You passed on everyone Lanyard found.");
    await expect(list(page)).not.toContainText("turn off");
    await expect(page.getByRole("button", { name: "See them again" })).toBeVisible();
  });

  test("a person locked by a failed pass explains why, with Refresh, even after other actions succeed", async ({ page }) => {
    await savedAsk(page, "made-up");
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(3) }));
    let failNext = true;
    await page.route("**/api/rejections", (route) => {
      if (failNext) {
        failNext = false;
        return route.fulfill({ status: 503, json: { error: "Rejection saved, but the count could not be read. Do not resubmit." } });
      }
      return route.fulfill({ json: { rejections: 2, hiddenBelowRank: null } });
    });
    await open(page, "made-up");
    await passButton(page).click(); // Person 1's pass fails
    await expect(alertWithText(page)).toContainText("Person 1");
    await rows(page).nth(1).click();
    await passButton(page).click(); // Person 2's succeeds, and clears the alert at the top
    await expect(page.getByRole("status").filter({ hasText: "Passed" })).toHaveText("Passed on Person 2.");
    // Back to Person 1: still locked, and the open profile says why, with a way out.
    await rows(page).nth(0).click();
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 1");
    await expect(passButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(card(page)).toContainText("couldn't confirm your pass on Person 1");
    const reloading = page.waitForRequest((r) => r.url().endsWith("/api/match"));
    await card(page).getByRole("button", { name: "refresh the matches" }).click();
    await reloading;
    await rows(page).first().click();
    await expect(passButton(page)).not.toHaveAttribute("aria-disabled", "true");
  });

  test("passing the top three ends on the cutoff, not on \"You passed on everyone\"", async ({ page }) => {
    await savedAsk(page, "made-up");
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(5) }));
    let passes = 0;
    await page.route("**/api/rejections", (route) => {
      passes++;
      return route.fulfill({ json: { rejections: passes, hiddenBelowRank: passes >= 3 ? 2 : null } });
    });
    await open(page, "made-up");
    for (const name of ["Person 1", "Person 2", "Person 3"]) {
      await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(name);
      await passButton(page).click();
    }
    await expect(rows(page)).toHaveCount(0);
    await expect(list(page).getByRole("heading", { level: 2 })).toHaveText("That's everyone for now");
    await expect(list(page)).toContainText("Lanyard hid everyone ranked below them");
    await expect(list(page)).toContainText("Try asking it another way");
    await expect(list(page)).not.toContainText("You passed on everyone");
    await expect(page.getByRole("button", { name: "See them again" })).toHaveCount(0); // the cutoff stays either way
  });

  test("a search that finds no one says so, even after earlier requests", async ({ page }) => {
    await savedAsk(page, "made-up");
    const sentView = (n: number) => ({
      id: `r-earlier-${n}`, askId: "made-up", fromUserId: ME, toPersonId: `x_${n}`, question: "q", minutes: 5,
      status: "sent", reply: null, slot: null, createdAt: "2026-11-05T12:00:00Z", type: "knowledge",
      person: fakeMatches(n + 1)[n].person,
    });
    await page.route("**/api/requests/sent", (route) => route.fulfill({ json: [sentView(0), sentView(1)] }));
    await page.route("**/api/match", (route) => route.fulfill({ json: [] })); // everyone was sent the ask; the search finds no one
    await open(page, "made-up");
    // No search: the earlier requests explain the empty list.
    await expect(list(page).getByRole("heading", { level: 2 })).toHaveText("That's everyone for now");
    await page.getByRole("searchbox", { name: "Narrow the list" }).fill("Haskell");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(list(page).getByRole("heading", { level: 2 })).toHaveText("No one matches yet");
    await expect(list(page)).toContainText("Try a different search, or show everyone.");
    await expect(page.getByRole("button", { name: "See them again" })).toHaveCount(0);
  });

  test("after a save, focus stays where the user moved it", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(3) }));
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/requests", async (route) => {
      await held;
      return route.fulfill({ json: { id: "r-held" } });
    });
    await open(page, "made-up");
    await sendButton(page).click(); // Person 1's send waits
    await rows(page).nth(2).click(); // meanwhile the user opens Person 3
    await rows(page).nth(2).focus();
    release();
    await expect(rows(page).nth(0)).toContainText("Request sent");
    // Person 3 stays open and focused: the save doesn't pull the user back to Person 2.
    await expect(rows(page).nth(2)).toHaveAttribute("aria-expanded", "true");
    await expect(rows(page).nth(2)).toBeFocused();
    // A later, unrelated change (closing a row) doesn't jump focus anywhere.
    await rows(page).nth(2).click();
    await expect(rows(page).nth(2)).toBeFocused();
  });

  test("a second failed pass keeps the first person locked too, until Refresh matches", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(3) }));
    let passes = 0;
    let sends = 0;
    await page.route("**/api/rejections", (route) => {
      passes++;
      return route.fulfill({ status: 503, json: { error: "Rejection saved, but the count could not be read. Do not resubmit." } });
    });
    await page.route("**/api/requests", (route) => {
      sends++;
      return route.fulfill({ json: { id: "r-locked" } });
    });
    await open(page, "made-up");
    await passButton(page).click(); // Person 1's pass fails
    await expect(alertWithText(page)).toContainText("Person 1");
    await rows(page).nth(1).click();
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    await passButton(page).click(); // and so does Person 2's
    await expect(alertWithText(page)).toContainText("Person 2");
    await expect(passButton(page)).toHaveAttribute("aria-disabled", "true");
    // Back to Person 1: still locked, and presses send nothing.
    await rows(page).nth(0).click();
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 1");
    await expect(passButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(sendButton(page)).toHaveAttribute("aria-disabled", "true");
    await passButton(page).click({ force: true });
    await sendButton(page).click({ force: true });
    await page.waitForTimeout(500);
    expect(passes).toBe(2);
    expect(sends).toBe(0);
  });

  test("evidence with angle brackets is shown as written", async ({ page }) => {
    const [one] = fakeMatches(1);
    await page.route("**/api/match", (route) =>
      route.fulfill({ json: [{ ...one, highlights: ["Returns Option<T> from a <em>Vec<u8></em> parser"] }] }),
    );
    await open(page, "made-up");
    await expect(card(page)).toContainText("Returns Option<T> from a Vec<u8> parser");
    await expect(card(page).locator("mark")).toHaveText("Vec<u8>");
  });

  test("a failed send keeps the card, and can be tried again", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
    let sends = 0;
    await page.route("**/api/requests", (route) => {
      sends++;
      return sends === 1
        ? route.fulfill({ status: 503, json: { error: "Request may have been saved; check before retrying." } })
        : route.fulfill({ json: { id: "r1" } });
    });
    await open(page, "made-up");
    await sendButton(page).click();
    await expect(alertWithText(page)).toContainText("check before retrying");
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 1");
    await sendButton(page).click();
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    expect(sends).toBe(2);
  });

  test("the search box narrows the list through the server", async ({ page }) => {
    const askId = await newAsk(page);
    await open(page, askId);
    await expect(card(page)).toBeVisible();
    const searching = page.waitForRequest((r) => r.url().endsWith("/api/match") && !!r.postDataJSON().query);
    await page.getByRole("searchbox", { name: "Narrow the list" }).fill("Rust");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    expect((await searching).postDataJSON()).toEqual({ askId, query: "Rust" });
    await expect(page.getByText(/Showing people for .Rust./)).toBeVisible();
    await page.getByRole("button", { name: "Show everyone" }).click();
    await expect(page.getByText(/Showing people for/)).toHaveCount(0);
  });

  test("no matches, someone else's ask, and no ask at all each explain what to do", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: [] }));
    await open(page, "made-up");
    await expect(page.getByRole("heading", { name: "No one matches yet" })).toBeVisible();
    await page.unroute("**/api/match");

    await open(page, "not-a-real-ask");
    await expect(alertWithText(page)).toContainText("isn't yours or no longer exists");
    await expect(page.getByRole("link", { name: "Ask a question" })).toHaveAttribute("href", "/ask");

    await page.goto("/matches");
    await expect(page.getByText("Ask a question first")).toBeVisible();
  });

  test("going through every card ends with what was sent", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
    await page.route("**/api/requests", (route) => route.fulfill({ json: { id: "r" } }));
    await page.route("**/api/rejections", (route) => route.fulfill({ json: { rejections: 1, hiddenBelowRank: null } }));
    await open(page, "made-up");
    await sendButton(page).click();
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    await passButton(page).click();
    await expect(page.getByRole("heading", { name: "That's everyone for now" })).toBeVisible();
    await expect(page.getByText("You sent a request to Person 1.")).toBeVisible();
  });

  test("turning the soft blocker off brings back people passed on, and the server keeps the choice", async ({ page }) => {
    const askId = await newAsk(page);
    await hidePassed(page, askId);
    const [first] = await serverMatches(page, askId);
    await open(page, askId);
    const blocker = page.getByRole("switch", { name: "Keep people I pass on hidden" });
    await expect(blocker).toBeChecked();
    await passButton(page).click();
    await expect(page.getByRole("status").filter({ hasText: "Passed" })).toHaveText(`Passed on ${first.person.name}.`);

    // GET /api/asks/:id supplied the saved setting: the first press changes it to off.
    const saving = page.waitForRequest((r) => r.url().endsWith("/api/soft-blocker") && r.method() === "PUT");
    await blocker.click({ force: true });
    expect((await saving).postDataJSON()).toEqual({ askId, enabled: false });
    await expect(blocker).not.toBeChecked();
    await expect(page.getByText("Off: people you passed on can show up again.")).toBeVisible();
    // The list reloads with the passed person back, as the server now matches them again.
    await expect(rows(page).first()).toContainText(first.person.name);
    expect((await serverMatches(page, askId)).map((m) => m.person.id)).toContain(first.person.id);

    await page.reload();
    await expect(blocker).not.toBeChecked();
  });

  test("a new tab shows the saved question and switch setting, read back from the server", async ({ page, browser }) => {
    const askId = await newAsk(page);
    const saved = await page.request.put("/api/soft-blocker", { headers: { "x-demo-user": ME }, data: { askId, enabled: false } });
    expect(saved.ok()).toBe(true);
    const ask = await (await page.request.get(`/api/asks/${askId}`, { headers: { "x-demo-user": ME } })).json();
    // A fresh context has none of this tab's copies: everything comes from GET /api/asks/:id.
    const fresh = await (await browser.newContext()).newPage();
    await open(fresh, askId);
    await expect(fresh.getByRole("switch", { name: "Keep people I pass on hidden" })).not.toBeChecked();
    await expect(fresh.getByText(ask.refined.text)).toBeVisible();
    await fresh.context().close();
  });

  test("if the saved setting doesn't load, the screen says so and Try again loads it", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
    let loads = 0;
    await page.route("**/api/asks/made-up", (route) =>
      ++loads === 1 ? route.fulfill({ status: 503, json: { error: "down" } }) : route.fulfill({ json: askJson("made-up", false) }),
    );
    await open(page, "made-up");
    const blocker = page.getByRole("switch", { name: "Keep people I pass on hidden" });
    await expect(alertWithText(page)).toContainText("setting didn't load.");
    await expect(card(page)).toBeVisible(); // the matches load anyway
    await expect(blocker).toHaveCount(0);
    await alertWithText(page).getByRole("button", { name: "Try again" }).click();
    await expect(blocker).not.toBeChecked();
    await expect(alertWithText(page)).toHaveCount(0);
  });

  test("moving to another ask never shows the last one's switch setting", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
    await savedAsk(page, "made-up"); // on
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/api/asks/other-ask", async (route) => {
      await held;
      return route.fulfill({ json: askJson("other-ask", false) });
    });
    await open(page, "made-up");
    const blocker = page.getByRole("switch", { name: "Keep people I pass on hidden" });
    await expect(blocker).toBeChecked();
    await page.evaluate(() => window.history.pushState(null, "", "/matches?ask=other-ask"));
    await expect(blocker).toHaveCount(0); // hidden while the other ask loads, never this one's "on"
    release();
    await expect(blocker).not.toBeChecked();
  });

  test("a failed soft-blocker save leaves the switch as it was", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
    await page.route("**/api/soft-blocker", (route) => route.fulfill({ status: 503, json: { error: "Storage unavailable" } }));
    await savedAsk(page, "made-up");
    await open(page, "made-up");
    const blocker = page.getByRole("switch", { name: "Keep people I pass on hidden" });
    await blocker.click({ force: true });
    await expect(alertWithText(page)).toHaveText("Storage unavailable");
    await expect(blocker).toBeChecked();
    await expect(blocker).not.toHaveAttribute("aria-disabled", "true");
  });

  test("while a send is saving, Search and the switch wait, so it can't land on a new deck", async ({ page }) => {
    let loads = 0;
    await page.route("**/api/match", (route) => {
      loads++;
      return route.fulfill({ json: fakeMatches(2) });
    });
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/api/requests", async (route) => {
      await held;
      return route.fulfill({ json: { id: "r1" } });
    });
    let puts = 0;
    await page.route("**/api/soft-blocker", (route) => {
      puts++;
      return route.fulfill({ json: { askId: "made-up", enabled: true } });
    });
    await savedAsk(page, "made-up");
    await open(page, "made-up");
    await sendButton(page).click();
    await page.getByRole("button", { name: "Search", exact: true }).click({ force: true });
    await page.getByRole("switch", { name: "Keep people I pass on hidden" }).click({ force: true });
    release();
    await expect(page.getByRole("status").filter({ hasText: "Request sent" })).toHaveText("Request sent to Person 1.");
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    expect(loads).toBe(1);
    expect(puts).toBe(0);
  });

  test("the switch waits for the saved setting and its first press changes that value", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(1) }));
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/asks/made-up", async route => {
      await held;
      return route.fulfill({ json: askJson("made-up", true) });
    });
    const sent: boolean[] = [];
    await page.route("**/api/soft-blocker", (route) => {
      const { enabled } = route.request().postDataJSON();
      sent.push(enabled);
      return route.fulfill({ json: { askId: "made-up", enabled } }); // the server echoes what it saved
    });
    await open(page, "made-up");
    const blocker = page.getByRole("switch", { name: "Keep people I pass on hidden" });
    await expect(card(page)).toBeVisible();
    await expect(blocker).toHaveCount(0);
    release();
    await expect(blocker).toBeChecked();
    await blocker.click({ force: true });
    await expect(page.getByText(/^Off: people you passed on/)).toBeVisible();
    await blocker.click({ force: true });
    await expect(page.getByText(/^On: people you passed on/)).toBeVisible();
    expect(sent).toEqual([false, true]);
  });

  test("Pass and Send are disabled while the switch saves", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/api/soft-blocker", async (route) => {
      await held;
      return route.fulfill({ json: { askId: "made-up", enabled: false } });
    });
    await savedAsk(page, "made-up");
    await open(page, "made-up");
    await page.getByRole("switch", { name: "Keep people I pass on hidden" }).click({ force: true });
    await expect(passButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(sendButton(page)).toHaveAttribute("aria-disabled", "true");
    release();
    // The saved switch reloads the list; the buttons are usable again.
    await expect(page.getByText("Off: people you passed on can show up again.")).toBeVisible();
    await rows(page).first().click();
    await expect(sendButton(page)).not.toHaveAttribute("aria-disabled", "true");
  });

  test("the switch keeps keyboard focus while saving, and waits for a pass in flight", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(3) }));
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/api/rejections", async (route) => {
      await held;
      return route.fulfill({ json: { rejections: 1, hiddenBelowRank: null } });
    });
    let puts = 0;
    await page.route("**/api/soft-blocker", (route) => {
      puts++;
      return route.fulfill({ json: { askId: "made-up", enabled: false } });
    });
    await savedAsk(page, "made-up");
    await open(page, "made-up");
    const blocker = page.getByRole("switch", { name: "Keep people I pass on hidden" });

    // While a pass is saving, the switch says it's unavailable and ignores presses.
    await passButton(page).click();
    await expect(blocker).toHaveAttribute("aria-disabled", "true");
    await blocker.focus();
    await page.keyboard.press("Space");
    expect(puts).toBe(0);
    release();
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");

    // Saving the switch keeps focus on it.
    await blocker.focus();
    await page.keyboard.press("Space");
    await expect(blocker).not.toBeChecked();
    await expect(blocker).toBeFocused();
    expect(puts).toBe(1);
  });

  test("recipients stay left out on the server, and a reload still says who has the question", async ({ page }) => {
    const askId = await newAsk(page);
    const picks = (await serverMatches(page, askId)).slice(0, 2);
    expect(picks).toHaveLength(2);
    const ids = new Set(picks.map(match => match.person.id));
    // Keep two real cards; the real fake handler, rather than tab storage, decides their exclusions.
    await page.route("**/api/match", async route => {
      const response = await route.fetch();
      const matches = (await response.json()) as Match[];
      return route.fulfill({ response, json: matches.filter(match => ids.has(match.person.id)) });
    });
    await open(page, askId);
    for (const pick of picks) {
      await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(pick.person.name);
      await sendButton(page).click();
    }
    await expect(page.getByRole("heading", { name: "That's everyone for now" })).toBeVisible();
    // A reload wouldn't bring them back (the server leaves out people sent the question), so it isn't offered.
    await expect(page.getByRole("button", { name: "See them again" })).toHaveCount(0);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "That's everyone for now" })).toBeVisible();
    expect((await serverMatches(page, askId)).some(match => ids.has(match.person.id))).toBe(false);
  });

  test("Mark as answered resolves the ask, and suggests staying in touch with the people sent requests", async ({ page }) => {
    const askId = await newAsk(page);
    const [first] = await serverMatches(page, askId);
    await open(page, askId);
    await sendButton(page).click();
    await expect(page.getByRole("status").filter({ hasText: "Request sent" })).toBeVisible();
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.getByRole("button", { name: "Mark as answered" })).toBeVisible();
    const resolving = page.waitForRequest((r) => r.url().endsWith(`/api/asks/${askId}/resolve`) && r.method() === "POST");
    await page.getByRole("button", { name: "Mark as answered" }).click();
    await resolving;
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Marked as answered");
    const link = page.getByRole("link", { name: new RegExp(`${first.person.name}.*@${first.person.githubLogin} on GitHub`) });
    await expect(link).toHaveAttribute("href", `https://github.com/${first.person.githubLogin}`);
    await expect(link).toHaveAttribute("target", "_blank");
    // Saved: resolving again (safe to repeat) reports it resolved.
    const again = await page.request.post(`/api/asks/${askId}/resolve`, { headers: { "x-demo-user": ME } });
    expect((await again.json()).status).toBe("resolved");
  });

  test("a late sent-history snapshot keeps a request sent while it was loading", async ({ page }) => {
    const askId = await newAsk(page);
    const [first] = await serverMatches(page, askId);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/requests/sent", async route => {
      await held;
      return route.fulfill({ json: [] }); // snapshot from before the send
    });
    await open(page, askId);
    await sendButton(page).click();
    await expect(page.getByRole("status").filter({ hasText: "Request sent" })).toBeVisible();
    const loaded = page.waitForResponse("**/api/requests/sent");
    release();
    await loaded;
    await expect(page.getByText("Loading your sent requests…")).toHaveCount(0);
    await page.getByRole("button", { name: "Mark as answered" }).click();
    await expect(page.getByRole("link", { name: new RegExp(`${first.person.name}.*@${first.person.githubLogin} on GitHub`) })).toBeVisible();
  });

  test("a failed sent-history load offers retry instead of claiming nobody was sent the ask", async ({ page }) => {
    const askId = await newAsk(page);
    const [first] = await serverMatches(page, askId);
    const sent = await page.request.post("/api/requests", {
      headers: { "x-demo-user": ME }, data: { askId, toPersonId: first.person.id },
    });
    expect(sent.ok()).toBe(true);
    let loads = 0;
    await page.route("**/api/requests/sent", async route => {
      if (++loads === 1) return route.fulfill({ status: 503, json: { error: "unavailable" } });
      return route.fulfill({ response: await route.fetch() });
    });
    await open(page, askId);
    const error = page.getByRole("alert").filter({ hasText: "Your sent requests didn't load." });
    await expect(error).toBeVisible();
    await error.getByRole("button", { name: "Try again" }).click();
    await expect(error).toHaveCount(0);
    await page.getByRole("button", { name: "Mark as answered" }).click();
    await expect(page.getByRole("link", { name: new RegExp(`${first.person.name}.*@${first.person.githubLogin} on GitHub`) })).toBeVisible();
  });

  test("a failed resolve can be tried again", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(1) }));
    let calls = 0;
    await page.route("**/resolve", (route) => {
      calls++;
      return calls === 1
        ? route.fulfill({ status: 503, json: { error: "Search sync failed; retry the same ID." } })
        : route.fulfill({ json: { id: "made-up", status: "resolved" } });
    });
    await open(page, "made-up");
    await page.getByRole("button", { name: "Mark as answered" }).click();
    await expect(alertWithText(page)).toHaveText("Search sync failed; retry the same ID.");
    await page.getByRole("button", { name: "Mark as answered" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Marked as answered");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
      let sends = 0; // each request gets its own ID, as on the server
      await page.route("**/api/requests", (route) => route.fulfill({ json: { id: `r${++sends}` } }));
      const scan = async (label: string) =>
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, label).toEqual([]);
      await savedAsk(page, "made-up");
      await open(page, "made-up");
      await expect(card(page)).toBeVisible();
      await scan("card");
      await sendButton(page).click();
      await sendButton(page).click();
      await expect(page.getByRole("heading", { name: "That's everyone for now" })).toBeVisible();
      await scan("end");
    });
  }
});
