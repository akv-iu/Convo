import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * A2 step 4: requests and the receiver's inbox, on the fake API. Two
 * browsers act as two people: one sends from the match cards, the other
 * answers in their inbox. Every request is new, so tests don't collide.
 */

const AFTER_SUBMIT = 15_000;
const SENDER = "p_003";

async function asPerson(browser: Browser, id: string): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-demo-user": id } });
  return context.newPage();
}

/** Sender makes an ask and sends it to `to` through the API; returns the request ID. */
async function sendTo(page: Page, to: string, text = "how does the Kubernetes scheduler do preemption") {
  const refine = await page.request.post("/api/refine", { headers: { "x-demo-user": SENDER }, data: { text } });
  const { askId, refined } = await refine.json();
  const sent = await page.request.post("/api/requests", { headers: { "x-demo-user": SENDER }, data: { askId, toPersonId: to } });
  expect(sent.ok()).toBe(true);
  return { id: (await sent.json()).id as string, question: refined.text as string };
}

async function stored(page: Page, person: string, id: string) {
  const res = await page.request.get("/api/inbox", { headers: { "x-demo-user": person } });
  return ((await res.json()) as { id: string; status: string; reply: string | null }[]).find((r) => r.id === id);
}

/** A request's card, found by its ID (the phone and laptop runs send the same questions). */
const card = (page: Page, id: string) => page.locator(`article[aria-labelledby="req-${id}-q"]`);
const alertWithText = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

test.describe("requests and inbox (A2 step 4)", () => {
  test("two people: one sends from the cards, the other sees the question and accepts", async ({ browser }) => {
    const sender = await asPerson(browser, SENDER);
    await sender.goto("/ask");
    await sender.getByRole("textbox", { name: "Your question" }).fill("how does the Kubernetes scheduler do preemption");
    await sender.getByRole("button", { name: "Sharpen my question" }).click();
    const question = (await sender.locator("blockquote").textContent())!.trim();
    await sender.getByRole("link", { name: "Find people" }).click();
    const first = sender.getByRole("region", { name: "Matches" }).getByRole("article");
    await expect(first).toBeVisible({ timeout: AFTER_SUBMIT });
    const sending = sender.waitForResponse((r) => r.url().endsWith("/api/requests") && r.request().method() === "POST");
    await sender.getByRole("button", { name: /^Send request/ }).click();
    const request = await (await sending).json();

    const receiver = await asPerson(browser, request.toPersonId);
    await receiver.goto("/inbox");
    const mine = card(receiver, request.id);
    await expect(mine).toBeVisible();
    await expect(mine.getByRole("heading", { level: 2 })).toHaveText(question);
    await expect(mine).toContainText("New");
    await mine.getByRole("button", { name: "Accept this request" }).click();
    await expect(mine).toContainText("Accepted");
    expect((await stored(receiver, request.toPersonId, request.id))?.status).toBe("accepted");
    await sender.context().close();
    await receiver.context().close();
  });

  test("decline is saved", async ({ page, browser }) => {
    const { id } = await sendTo(page, "p_005", "how do eBPF maps work");
    const receiver = await asPerson(browser, "p_005");
    await receiver.goto("/inbox");
    const mine = card(receiver, id);
    await mine.getByRole("button", { name: "Decline this request" }).click();
    await expect(mine).toContainText("You declined this one.");
    expect((await stored(page, "p_005", id))?.status).toBe("declined");
    await receiver.context().close();
  });

  test("a short reply instead of meeting is saved and shown", async ({ page, browser }) => {
    const { id } = await sendTo(page, "p_004", "what is the best way to learn Rust");
    const receiver = await asPerson(browser, "p_004");
    await receiver.goto("/inbox");
    const mine = card(receiver, id);
    await mine.getByRole("button", { name: "Reply instead" }).click();
    const box = mine.getByRole("textbox", { name: "Your reply" });
    await expect(box).toBeFocused();
    await mine.getByRole("button", { name: "Send reply" }).click();
    await expect(mine.getByText("Write a short reply first.")).toBeVisible();
    await box.fill("Read the Rust book, then rewrite a small tool you use.");
    await mine.getByRole("button", { name: "Send reply" }).click();
    await expect(mine).toContainText("You replied");
    await expect(mine).toContainText("Read the Rust book");
    const saved = await stored(page, "p_004", id);
    expect(saved).toMatchObject({ status: "answered", reply: "Read the Rust book, then rewrite a small tool you use." });
    await receiver.context().close();
  });

  test("a failed answer isn't retried by itself, and Reload requests shows what was saved", async ({ page, browser }) => {
    const { id } = await sendTo(page, "p_006", "how does etcd compaction work");
    const receiver = await asPerson(browser, "p_006");
    let calls = 0;
    await receiver.route("**/respond", (route) => {
      calls++;
      return route.fulfill({ status: 503, json: { error: "Your answer may have been saved; check the inbox first." } });
    });
    await receiver.goto("/inbox");
    const mine = card(receiver, id);
    await mine.getByRole("button", { name: "Accept this request" }).click();
    await expect(mine.getByRole("alert")).toContainText("check the inbox first");
    await receiver.waitForTimeout(400);
    expect(calls).toBe(1);
    await mine.getByRole("button", { name: "Reload requests" }).click();
    await expect(card(receiver, id)).toContainText("New");
    await receiver.context().close();
  });

  test("an empty inbox says so, and a failed load is an error with Try again", async ({ browser }) => {
    const empty = await asPerson(browser, "nobody-yet");
    await empty.goto("/inbox");
    await expect(empty.getByRole("heading", { name: "No requests yet" })).toBeVisible();

    let calls = 0;
    await empty.route("**/api/inbox", (route) => {
      calls++;
      return calls === 1 ? route.fulfill({ status: 503, json: { error: "down" } }) : route.fulfill({ json: [] });
    });
    await empty.reload();
    await expect(alertWithText(empty)).toHaveText("Your requests didn't load. Try again in a moment.");
    await empty.getByRole("button", { name: "Try again" }).click();
    await expect(empty.getByRole("heading", { name: "No requests yet" })).toBeVisible();
    await empty.context().close();
  });

  test("the header links Ask and Requests", async ({ page }) => {
    await page.goto("/ask");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Requests" }).click();
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Requests");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page, browser }) => {
      const { id } = await sendTo(page, "p_002", `a11y check ${scheme}: how does gRPC streaming work`);
      const receiver = await asPerson(browser, "p_002");
      await receiver.emulateMedia({ colorScheme: scheme });
      await receiver.goto("/inbox");
      await expect(card(receiver, id)).toBeVisible();
      await card(receiver, id).getByRole("button", { name: "Reply instead" }).click();
      expect((await new AxeBuilder({ page: receiver }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
      await receiver.context().close();
    });
  }
});
