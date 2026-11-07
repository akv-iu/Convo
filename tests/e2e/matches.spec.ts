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
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 1");
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

  test("Pass and Send keep keyboard focus while they save", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await page.route("**/api/match", (route) => route.fulfill({ json: fakeMatches(3) }));
    await page.route("**/api/rejections", (route) => route.fulfill({ json: { rejections: 1, hiddenBelowRank: null } }));
    await page.route("**/api/requests", (route) => route.fulfill({ json: { id: "r1" } }));
    await open(page, "made-up");
    await passButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 2");
    await expect(passButton(page)).toBeFocused();
    await sendButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Person 3");
    await expect(sendButton(page)).toBeFocused();
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
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(first.person.name);
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

  test("See them again leaves out recipients on the server, including after reload", async ({ page }) => {
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
    await page.getByRole("button", { name: "See them again" }).click();
    await expect(page.getByRole("heading", { name: "No one matches yet" })).toBeVisible();
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.getByRole("heading", { name: "No one matches yet" })).toBeVisible();
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
      await page.route("**/api/requests", (route) => route.fulfill({ json: { id: "r" } }));
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
