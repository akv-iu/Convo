import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * A1 step 5: the ask box, on the fake API (canned AI: deterministic, free,
 * and "idiot" stands in for a moderation block). Send saves the question as
 * written; Sharpen with AI only suggests, and saves nothing.
 */

const AFTER_SUBMIT = 15_000;

const box = (page: Page) => page.getByRole("textbox", { name: "What do you want to ask?" });
const send = (page: Page) => page.getByRole("button", { name: "Send", exact: true });
const sharpen = (page: Page) => page.getByRole("button", { name: /^Sharpen (with AI|again)$/ });
const isSave = (req: Request) => req.url().endsWith("/api/asks") && req.method() === "POST";
const isPreview = (req: Request) => req.url().endsWith("/api/refine/preview") && req.method() === "POST";
const isOldRefine = (req: Request) => req.url().endsWith("/api/refine") && req.method() === "POST";
const alertWithText = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

async function open(page: Page, person = "p_003") {
  await page.setExtraHTTPHeaders({ "x-demo-user": person });
  await page.goto("/ask");
  await expect(box(page)).toBeVisible();
}

/** After Send: the matches for the new question; returns its ID. */
async function onMatches(page: Page) {
  await expect(page).toHaveURL(/\/matches\?ask=/, { timeout: AFTER_SUBMIT });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("People who can help");
  return new URL(page.url()).searchParams.get("ask")!;
}

/** A question saved on the server for `person`, as the ask screen saves it; returns its ID. */
async function savedAsk(page: Page, text: string, person = "p_003") {
  const res = await page.request.post("/api/asks", { headers: { "x-demo-user": person }, data: { text } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { askId: string }).askId;
}

/** Every request the ask box makes, so tests can check what was (and wasn't) sent. */
function watch(page: Page) {
  const seen: Request[] = [];
  page.on("request", (r) => {
    if (isSave(r) || isPreview(r) || isOldRefine(r)) seen.push(r);
  });
  return seen;
}

test.describe("ask as written, sharpening optional (A1 step 5)", () => {
  test("Send saves the question exactly as written and goes straight to the matches", async ({ page }) => {
    await open(page);
    const seen = watch(page);
    await box(page).fill("how does Raft do the voting thing");
    const saving = page.waitForRequest(isSave);
    await send(page).click();
    expect((await saving).postDataJSON()).toEqual({ text: "how does Raft do the voting thing" }); // no kind: the server defaults it

    // No "Current request" step in between: the matches open, with the question as written.
    const askId = await onMatches(page);
    await expect(page.getByText(/Your question: .how does Raft do the voting thing./)).toBeVisible();
    expect(seen.filter((r) => isPreview(r) || isOldRefine(r))).toHaveLength(0); // no AI rewrite

    // The server saved exactly that: read it back.
    const saved = await (await page.request.get(`/api/asks/${askId}`, { headers: { "x-demo-user": "p_003" } })).json();
    expect(saved).toMatchObject({
      rawText: "how does Raft do the voting thing",
      refined: { text: "how does Raft do the voting thing", type: "knowledge", minutes: 5 },
      softBlocker: false,
    });

    // Back to it: the "Current request" screen, read back from the address.
    await page.getByRole("link", { name: "Back to your question" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Current request");
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page.locator("blockquote")).toHaveText("how does Raft do the voting thing");
    await expect(page.getByText("Learn something")).toHaveCount(0); // no kind chip; the length stays
    await expect(page.getByText("5-minute chat")).toBeVisible();
    await expect(page.getByText("You first wrote:")).toHaveCount(0);
  });

  test("the box shows a character count, and no shortcut hint", async ({ page }) => {
    await open(page);
    await box(page).fill("how does etcd store keys");
    await expect(page.getByText("24 of 500")).toBeVisible();
    await expect(page.getByText(/Ctrl\+Enter/)).toHaveCount(0);
  });

  test("Sharpen suggests a question without saving it; edit the suggestion, then send that", async ({ page }) => {
    await open(page);
    const seen = watch(page);
    await box(page).fill("I want a job at Stripe");
    const previewing = page.waitForRequest(isPreview);
    await sharpen(page).click();
    expect((await previewing).postDataJSON()).toEqual({ text: "I want a job at Stripe" });
    await expect(box(page)).toHaveValue(/^I want a job at Stripe\. .+\?$/);
    await expect(page.getByText("Sharpened with AI.")).toBeVisible();
    expect(seen.filter(isSave)).toHaveLength(0); // a preview saves nothing

    await box(page).fill("I want a job at Stripe. What did you do before joining?");
    const saving = page.waitForRequest(isSave);
    await send(page).click();
    expect((await saving).postDataJSON()).toEqual({ text: "I want a job at Stripe. What did you do before joining?" });
    await onMatches(page); // the asker chose in the box, so Send goes straight on
    await expect(page.getByText(/Your question: .I want a job at Stripe\. What did you do before joining\?./)).toBeVisible();
    expect(seen.filter(isSave)).toHaveLength(1);
  });

  test("Use my original puts your own words back, and that's what's sent", async ({ page }) => {
    await open(page);
    await box(page).fill("how does etcd store keys");
    await sharpen(page).click();
    await expect(page.getByText("Sharpened with AI.")).toBeVisible();
    await page.getByRole("button", { name: "use my original" }).click();
    await expect(box(page)).toHaveValue("how does etcd store keys");
    await expect(box(page)).toBeFocused();
    await expect(page.getByText("Sharpened with AI.")).toHaveCount(0);
    const saving = page.waitForRequest(isSave);
    await send(page).click();
    expect((await saving).postDataJSON()).toMatchObject({ text: "how does etcd store keys" });
    await onMatches(page);
  });

  test("there's no kind-of-question picker: Send carries only the text", async ({ page }) => {
    await open(page);
    await expect(page.getByText("What kind of question is it?")).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
    await box(page).fill("anyone want to build a Raft visualiser with me");
    const saving = page.waitForRequest(isSave);
    await send(page).click();
    expect((await saving).postDataJSON()).toEqual({ text: "anyone want to build a Raft visualiser with me" });
    const askId = await onMatches(page);
    // The server gives it the default kind.
    const saved = await (await page.request.get(`/api/asks/${askId}`, { headers: { "x-demo-user": "p_003" } })).json();
    expect(saved.refined).toMatchObject({ type: "knowledge", minutes: 5 });
  });

  test("browser Back after Send brings the box back unlocked, ready for another question", async ({ page, isMobile }) => {
    await open(page);
    await box(page).fill("how does etcd store keys");
    await send(page).click();
    await onMatches(page);
    await page.goBack();
    await expect(box(page)).toBeVisible({ timeout: AFTER_SUBMIT });
    // Not stuck on "Sending…": both buttons are available again.
    await expect(send(page)).toBeVisible();
    await expect(send(page)).not.toHaveAttribute("aria-disabled", "true");
    await expect(sharpen(page)).not.toHaveAttribute("aria-disabled", "true");
    await box(page).fill("how does Raft pick a leader");
    const saving = page.waitForRequest(isSave);
    if (isMobile) await send(page).click();
    else {
      await box(page).focus();
      await page.keyboard.press("Control+Enter");
    }
    expect((await saving).postDataJSON()).toEqual({ text: "how does Raft pick a leader" });
    await onMatches(page);
  });

  test("too short is explained and nothing is sent, by either button", async ({ page }) => {
    await open(page);
    const seen = watch(page);
    await box(page).fill("hi");
    await send(page).click();
    await expect(page.getByText("Write a few words about what you want to ask.")).toBeVisible();
    await expect(box(page)).toBeFocused();
    await sharpen(page).click();
    expect(seen).toHaveLength(0);
  });

  test("a blocked ask shows the reason, keeps the text, and nothing is saved", async ({ page }) => {
    await open(page);
    await box(page).fill("why is my manager such an idiot");
    await send(page).click();
    await expect(alertWithText(page)).toContainText("looks offensive or unsafe");
    await expect(box(page)).toHaveValue("why is my manager such an idiot");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("What do you want to ask?");
    // Sharpening it is refused the same way.
    await sharpen(page).click();
    await expect(alertWithText(page)).toContainText("looks offensive or unsafe");
    await expect(box(page)).toHaveValue("why is my manager such an idiot");
  });

  test("a failed send can be retried, and only one save is in flight", async ({ page }) => {
    await open(page);
    let calls = 0;
    await page.route("**/api/asks", async (route) => {
      calls++;
      if (calls === 1) {
        await new Promise((r) => setTimeout(r, 400));
        return route.fulfill({ status: 503, json: { error: "Lanyard is busy. Try again." } });
      }
      return route.fallback();
    });
    await box(page).fill("how does etcd store keys");
    await send(page).click();
    const sending = page.getByRole("button", { name: "Sending…" });
    await expect(sending).toHaveAttribute("aria-disabled", "true");
    await sending.click({ force: true }); // a second press while saving does nothing
    await expect(alertWithText(page)).toHaveText("Lanyard is busy. Try again.");
    expect(calls).toBe(1);
    await send(page).click();
    await onMatches(page);
    expect(calls).toBe(2);
  });

  test("a failed sharpen keeps your words and says you can still send them", async ({ page }) => {
    await open(page);
    await page.route("**/api/refine/preview", (route) => route.fulfill({ status: 503, json: { error: "Question refinement is unavailable. Try again." } }));
    await box(page).fill("how does etcd store keys");
    await sharpen(page).click();
    await expect(alertWithText(page)).toHaveText("Question refinement is unavailable. Try again. You can still send it as written.");
    await expect(box(page)).toHaveValue("how does etcd store keys");
    await send(page).click();
    await onMatches(page);
  });

  test("an unfinished profile is sent to set up first", async ({ page }) => {
    await open(page);
    await page.route("**/api/asks", (route) => route.fulfill({ status: 409, json: { error: "Complete onboarding first." } }));
    await box(page).fill("how does etcd store keys");
    await send(page).click();
    await expect(alertWithText(page)).toContainText("Finish setting up your badge first.");
    await expect(page.getByRole("link", { name: "Set up your badge" })).toHaveAttribute("href", "/signin");
  });

  test("Ask something else, from the question read back, starts with an empty box", async ({ page }) => {
    await open(page);
    await box(page).fill("how does Raft do the voting thing");
    await send(page).click();
    await onMatches(page);
    await page.getByRole("link", { name: "Back to your question" }).click();
    await expect(page).toHaveURL(/\/ask\?ask=/); // the address points at the saved question
    await page.getByRole("button", { name: "Ask something else" }).click();
    await expect(box(page)).toBeFocused();
    await expect(box(page)).toHaveValue("");
    await expect(page).toHaveURL(/\/ask$/); // and stops pointing at it
  });

  test("works with the keyboard alone: Ctrl+Enter sends as written", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await open(page);
    await page.keyboard.press("Tab"); // skip link
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await box(page).focus();
    await page.keyboard.type("how does the scheduler do preemption");
    const saving = page.waitForRequest(isSave);
    await page.keyboard.press("Control+Enter");
    expect((await saving).postDataJSON()).toMatchObject({ text: "how does the scheduler do preemption" });
    await onMatches(page);
  });

  test("the counter shows how many people are looking, as the server counts them", async ({ page }) => {
    const res = await page.request.get("/api/looking-for-me", { headers: { "x-demo-user": "p_003" } });
    expect(res.ok()).toBe(true);
    const { count } = await res.json();
    await open(page);
    const banner = page.getByTestId("looking-for-you");
    await expect(banner).toBeVisible();
    if (count === 0) await expect(banner).toContainText("No one is asking for someone like you yet");
    else await expect(banner).toContainText(`${count.toLocaleString("en-US")} ${count === 1 ? "person" : "people"} here`);
  });

  test("the counter words one and many", async ({ page }) => {
    let count = 1;
    await page.route("**/api/looking-for-me", (route) => route.fulfill({ json: { count } }));
    await open(page);
    await expect(page.getByTestId("looking-for-you")).toHaveText("1 person here is looking for someone like you");
    count = 12;
    await page.reload();
    await expect(page.getByTestId("looking-for-you")).toHaveText("12 people here are looking for someone like you");
  });

  test("a failed counter says so with Try again, never zero", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/looking-for-me", (route) => {
      calls++;
      return calls === 1 ? route.fulfill({ status: 503, json: { error: "Search unavailable" } }) : route.fulfill({ json: { count: 4 } });
    });
    await open(page);
    await expect(page.getByText("Couldn't load who's looking for you.")).toBeVisible();
    await expect(page.getByTestId("looking-for-you")).toHaveCount(0);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("looking-for-you")).toContainText("4 people here");
  });

  test("the header leads back to your profile", async ({ page }) => {
    await open(page);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
  });

  test("a resolved question read back says it's answered, and offers no Find people", async ({ page }) => {
    const askId = await savedAsk(page, "how do you size etcd for 500 nodes");
    const resolved = await page.request.post(`/api/asks/${askId}/resolve`, { headers: { "x-demo-user": "p_003" } });
    expect(resolved.ok()).toBe(true);
    await page.setExtraHTTPHeaders({ "x-demo-user": "p_003" });
    await page.goto(`/ask?ask=${askId}`);
    await expect(page.locator("blockquote")).toHaveText("how do you size etcd for 500 nodes", { timeout: AFTER_SUBMIT });
    await expect(page.getByText("You marked this question as answered")).toBeVisible();
    await expect(page.getByRole("link", { name: "Find people" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ask something else" })).toBeVisible();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const scan = async (label: string) =>
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, label).toEqual([]);
      await open(page);
      await expect(page.getByTestId("looking-for-you")).toBeVisible();
      await send(page).click();
      await expect(page.getByText("Write a few words about what you want to ask.")).toBeVisible();
      await scan("empty with a problem");
      await box(page).fill("how does Raft do the voting thing");
      await sharpen(page).click();
      await expect(page.getByText("Sharpened with AI.")).toBeVisible();
      await scan("sharpened suggestion");
      await send(page).click();
      await onMatches(page);
      await page.getByRole("link", { name: "Back to your question" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Current request");
      await scan("read back");
    });
  }
});

test.describe("reading a saved question back (/ask?ask=<id>)", () => {
  test("Ask something else wins over a read-back reply that arrives late: the new draft stays", async ({ page }) => {
    const askId = await savedAsk(page, "how does etcd store keys");
    // This tab already has the question, so it shows at once while the server's copy is on its way.
    await page.addInitScript((id) => {
      const copy = [{ askId: id, rawText: "how does etcd store keys", refined: { text: "how does etcd store keys", type: "knowledge", minutes: 5 } }];
      sessionStorage.setItem("convo_asks", JSON.stringify(copy));
    }, askId);
    // Hold the server's copy until the asker has moved on, and make the move back to plain /ask
    // slow: Next fetches /ask's page data (prefetched from the header link) before the address changes.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let landed: () => void = () => {};
    const replied = new Promise<void>((resolve) => (landed = resolve));
    await page.route(`**/api/asks/${askId}`, async (route) => {
      await gate;
      await route.fallback();
      landed();
    });
    await page.route((url) => url.pathname === "/ask", async (route) => {
      if (route.request().headers()["rsc"]) await new Promise((r) => setTimeout(r, 4000));
      await route.fallback();
    });
    await page.setExtraHTTPHeaders({ "x-demo-user": "p_003" });
    await page.goto(`/ask?ask=${askId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Current request");
    await page.getByRole("button", { name: "Ask something else" }).click();
    await box(page).fill("a brand new draft");
    release();
    await replied; // the old question's reply lands while the address still says ?ask=
    await page.waitForTimeout(300);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("What do you want to ask?");
    await expect(box(page)).toHaveValue("a brand new draft");
    await expect(page).toHaveURL(/\/ask$/, { timeout: AFTER_SUBMIT });
    await expect(box(page)).toHaveValue("a brand new draft");
  });

  test("Back to your question from the matches shows that question, and a reload reads it from the server", async ({ page }) => {
    await open(page);
    await box(page).fill("how does the scheduler do preemption");
    await send(page).click();
    const askId = await onMatches(page);
    const back = page.getByRole("link", { name: "Back to your question" });
    await expect(back).toHaveAttribute("href", `/ask?ask=${askId}`);
    await back.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Current request");
    await expect(page.locator("blockquote")).toHaveText("how does the scheduler do preemption");

    // Without this tab's copy, the question still comes back: the server is read.
    await page.evaluate(() => sessionStorage.clear());
    const reading = page.waitForRequest((r) => r.url().endsWith(`/api/asks/${askId}`) && r.method() === "GET");
    await page.reload();
    await reading;
    await expect(page.locator("blockquote")).toHaveText("how does the scheduler do preemption");
    await expect(page.getByRole("link", { name: "Find people" })).toHaveAttribute("href", `/matches?ask=${askId}`);
  });

  test("someone else's or an unknown question says so, and offers an empty box", async ({ page }) => {
    const theirs = await savedAsk(page, "a question only p_004 asked", "p_004");
    for (const askId of [theirs, "no-such-ask"]) {
      await page.setExtraHTTPHeaders({ "x-demo-user": "p_003" });
      await page.goto(`/ask?ask=${askId}`);
      await expect(alertWithText(page)).toContainText("That question isn't one of yours, or it no longer exists.");
      await expect(box(page)).toHaveValue("");
      await expect(page.getByText("a question only p_004 asked")).toHaveCount(0);
    }
  });

  test("a failed load offers Try again, which then loads the question", async ({ page }) => {
    const askId = await savedAsk(page, "how does etcd store keys");
    let calls = 0;
    await page.route(`**/api/asks/${askId}`, (route) => {
      calls++;
      return calls === 1 ? route.fulfill({ status: 503, json: { error: "Ask storage is unavailable. Try again." } }) : route.fallback();
    });
    await page.setExtraHTTPHeaders({ "x-demo-user": "p_003" });
    await page.goto(`/ask?ask=${askId}`);
    await expect(alertWithText(page)).toContainText("Your question didn't load.");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("blockquote")).toHaveText("how does etcd store keys", { timeout: AFTER_SUBMIT });
    expect(calls).toBe(2);
  });
});
