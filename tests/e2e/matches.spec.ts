import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * A2 steps 1 and 2: result cards and swipe, on the fake API. Each test
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
};

const passButton = (page: Page) => page.getByRole("button", { name: /^←?\s*Pass$/ });
const sendButton = (page: Page) => page.getByRole("button", { name: /^Send request/ });
const card = (page: Page) => page.getByRole("region", { name: "Matches" }).getByRole("article");
const isPass = (r: Request) => r.url().endsWith("/api/rejections") && r.method() === "POST";
const isSend = (r: Request) => r.url().endsWith("/api/requests") && r.method() === "POST";
const alertWithText = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

async function newAsk(page: Page, text = "how does the Kubernetes scheduler do preemption") {
  const res = await page.request.post("/api/refine", { headers: { "x-demo-user": ME }, data: { text } });
  expect(res.ok()).toBe(true);
  return (await res.json()).askId as string;
}

async function serverMatches(page: Page, askId: string): Promise<Match[]> {
  const res = await page.request.post("/api/match", { headers: { "x-demo-user": ME }, data: { askId } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as Match[]).sort((a, b) => a.rank - b.rank);
}

async function open(page: Page, askId: string) {
  await page.setExtraHTTPHeaders({ "x-demo-user": ME });
  await page.goto(`/matches?ask=${askId}`);
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
      synthetic: rank % 2 === 1,
      freeTimes: [],
    },
    highlights: ["Raft <em>leader election</em>"],
    badges: rank === 0 ? [] : ["hiring", "US"],
    mutual: rank === 1,
    explanation: `Why person ${rank + 1}`,
    score: 1,
    rank,
  }));
}

test.describe("match cards and swipe (A2 steps 1-2)", () => {
  test("Find people on the refine screen opens the cards, best match first, with the question", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-demo-user": ME });
    await page.goto("/ask");
    await page.getByRole("textbox", { name: "Your question" }).fill("how does the Kubernetes scheduler do preemption");
    await page.getByRole("button", { name: "Sharpen my question" }).click();
    await page.getByRole("link", { name: "Find people" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("People who can help", { timeout: AFTER_SUBMIT });
    await expect(page.getByText(/Your question: .how does the Kubernetes scheduler do preemption:/)).toBeVisible();

    const askId = new URL(page.url()).searchParams.get("ask")!;
    const expected = await serverMatches(page, askId);
    expect(expected.length).toBeGreaterThan(0);
    const first = expected[0];
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(first.person.name);
    await expect(card(page)).toContainText(`1 of ${expected.length}`);
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

  test("Pass saves the pass with the card's rank, and that person drops out of the matches", async ({ page }) => {
    const askId = await newAsk(page);
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

  test("arrow keys pass and send, but not while typing in the search box", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    const askId = await newAsk(page);
    const expected = await serverMatches(page, askId);
    test.skip(expected.length < 2, "needs two matches");
    await open(page, askId);
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(expected[0].person.name);

    let saves = 0;
    page.on("request", (r) => {
      if (isPass(r) || isSend(r)) saves++;
    });
    await page.getByRole("searchbox", { name: "Narrow the list" }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    expect(saves).toBe(0);

    await page.getByRole("heading", { level: 1 }).click();
    const sending = page.waitForRequest(isSend);
    await page.keyboard.press("ArrowRight");
    await sending;
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(expected[1].person.name);
  });

  test("dragging the card far enough sends; a short drag snaps back", async ({ page }) => {
    const askId = await newAsk(page);
    const [first] = await serverMatches(page, askId);
    await open(page, askId);
    const box = (await card(page).boundingBox())!;
    const y = box.y + 30;
    const x = box.x + box.width / 2;

    let sends = 0;
    page.on("request", (r) => {
      if (isSend(r)) sends++;
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y, { steps: 4 });
    await page.mouse.up();
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(first.person.name);
    expect(sends).toBe(0);

    const sending = page.waitForRequest(isSend);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 200, y, { steps: 8 });
    await page.mouse.up();
    expect((await sending).postDataJSON()).toEqual({ askId, toPersonId: first.person.id });
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
    await expect(page.getByText("You've passed on three people, so Convo hid everyone ranked below them.")).toBeVisible();
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
    // Cutoff 4 keeps ranks 0-3: the deck moves on to Person 2 of the 4 left.
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    await expect(card(page)).toContainText("2 of 4");
    await expect(page.getByText("You've passed on three people, so Convo hid everyone ranked below them.")).toBeVisible();
  });

  test("a held arrow key acts once, not on every repeat", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(4) }));
    let sends = 0;
    await page.route("**/api/requests", (route) => {
      sends++;
      return route.fulfill({ json: { id: `r${sends}` } });
    });
    await open(page, "made-up");
    await expect(card(page)).toBeVisible();
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", repeat: true }));
    });
    await page.waitForTimeout(400);
    expect(sends).toBe(0);
    await page.keyboard.press("ArrowRight");
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    expect(sends).toBe(1);
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
    await expect(card(page)).toBeVisible();
    await page.getByRole("searchbox", { name: "Narrow the list" }).fill("Go");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(card(page)).toBeVisible();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(card(page)).toBeVisible();
    expect(loads).toBe(4);
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
    await page.waitForTimeout(500);
    expect(passes).toBe(1);
    const reloading = page.waitForRequest((r) => r.url().endsWith("/api/match"));
    await page.getByRole("button", { name: "Refresh matches" }).click();
    await reloading;
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 1");
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
    const [first] = await serverMatches(page, askId);
    await open(page, askId);
    const blocker = page.getByRole("switch", { name: "Keep people I pass on hidden" });
    await expect(blocker).toBeChecked();
    await passButton(page).click();
    await expect(page.getByRole("status").filter({ hasText: "Passed" })).toHaveText(`Passed on ${first.person.name}.`);

    const saving = page.waitForRequest((r) => r.url().endsWith("/api/soft-blocker") && r.method() === "PUT");
    await blocker.click({ force: true });
    expect((await saving).postDataJSON()).toEqual({ askId, enabled: false });
    await expect(blocker).not.toBeChecked();
    await expect(page.getByText("Off: people you passed on can show up again.")).toBeVisible();
    // The list reloads with the passed person back, as the server now matches them again.
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(first.person.name);
    expect((await serverMatches(page, askId)).map((m) => m.person.id)).toContain(first.person.id);

    await page.reload();
    await expect(blocker).not.toBeChecked();
  });

  test("a failed soft-blocker save leaves the switch as it was", async ({ page }) => {
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(2) }));
    await page.route("**/api/soft-blocker", (route) => route.fulfill({ status: 503, json: { error: "Storage unavailable" } }));
    await open(page, "made-up");
    const blocker = page.getByRole("switch", { name: "Keep people I pass on hidden" });
    await blocker.click({ force: true });
    await expect(alertWithText(page)).toHaveText("Storage unavailable");
    await expect(blocker).toBeChecked();
    await expect(blocker).not.toHaveAttribute("aria-disabled", "true");
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

  test("Mark as answered resolves the ask, and suggests staying in touch with the people sent requests", async ({ page }) => {
    const askId = await newAsk(page);
    const [first] = await serverMatches(page, askId);
    await open(page, askId);
    await sendButton(page).click();
    await expect(page.getByRole("status").filter({ hasText: "Request sent" })).toBeVisible();
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
      await page.route("**/api/requests", (route) => route.fulfill({ json: { id: "r" } }));
      const scan = async (label: string) =>
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, label).toEqual([]);
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
