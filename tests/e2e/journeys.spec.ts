import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The build plan's "done when" checks, end to end on the fake API.
 *
 * A1: from step 1 to a refined ask at phone, tablet and laptop sizes,
 * using only the keyboard (fields are reached with focus() and Tab, never
 * clicked), with an axe scan on every screen.
 *
 * A2: two browser windows as the two demo users. A sends a request from
 * the match cards, B accepts it and books a time, and A marks the ask
 * answered. Demo users A and B share free times, and no other test
 * changes them.
 */

const AFTER_SUBMIT = 15_000;
const DEMO_A = "u_demo_a";
const DEMO_B = "u_demo_b";
const QUESTION = "how does the Kubernetes scheduler do preemption";

const sizes = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "laptop", width: 1280, height: 800 },
] as const;

async function scan(page: Page, label: string) {
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, label).toEqual([]);
}

/** Press Tab until the target has focus (at most 25 presses), proving it's reachable by keyboard. */
async function tabTo(page: Page, target: ReturnType<Page["locator"]>) {
  for (let i = 0; i < 25; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

async function asPerson(browser: Browser, id: string, size: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-demo-user": id }, viewport: size });
  return context.newPage();
}

test.describe("done when (A1 and A2)", () => {
  for (const size of sizes) {
    test(`A1: step 1 to a refined ask with the keyboard alone, at ${size.name} size`, async ({ browser, isMobile }) => {
      test.skip(isMobile, "runs once, on the laptop project, at each size");
      const page = await asPerson(browser, DEMO_A, size);

      // Step 1: About you.
      await page.goto("/signin");
      await scan(page, `step 1 (${size.name})`);
      await page.getByRole("textbox", { name: "Your name" }).focus();
      await page.keyboard.type("Demo Requester");
      await page.keyboard.press("Tab");
      await expect(page.getByRole("combobox", { name: "Search for your workplace" })).toBeFocused();
      await page.keyboard.type("oxford");
      await expect(page.getByRole("listbox", { name: "Workplaces" }).getByRole("option").first()).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press("Enter");
      await expect(page.getByRole("combobox", { name: "Country" })).toHaveValue("GB");
      await page.getByRole("button", { name: "Continue", exact: true }).focus();
      await page.keyboard.press("Enter");

      // Step 2: Your badge.
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your badge", { timeout: AFTER_SUBMIT });
      await scan(page, `step 2 (${size.name})`);
      await page.getByRole("radio", { name: /Not right now/ }).focus();
      await page.keyboard.press("Space");
      await page.getByRole("button", { name: "Continue", exact: true }).focus();
      await page.keyboard.press("Enter");

      // Step 3: Free time.
      await expect(page).toHaveURL(/\/onboarding\/free-time$/, { timeout: AFTER_SUBMIT });
      await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
      await scan(page, `step 3 (${size.name})`);
      await page.getByRole("button", { name: "Continue", exact: true }).focus();
      await page.keyboard.press("Enter");

      // Step 4: Your details.
      await expect(page).toHaveURL(/\/onboarding\/profile$/, { timeout: AFTER_SUBMIT });
      await expect(page.getByRole("button", { name: "Yes, that's me" })).toBeVisible();
      await scan(page, `step 4 (${size.name})`);
      await page.getByRole("textbox", { name: "Email" }).fill("demo@example.com");
      await page.getByRole("button", { name: "Yes, that's me" }).focus();
      await page.keyboard.press("Enter");

      // Ask and refine.
      await expect(page).toHaveURL(/\/ask$/, { timeout: AFTER_SUBMIT });
      // Reach the question box with Tab alone, from wherever navigation left focus.
      await tabTo(page, page.getByRole("textbox", { name: "What do you want to ask?" }));
      await page.keyboard.type(QUESTION);
      await page.keyboard.press("Control+Enter");
      await expect(page.getByRole("heading", { level: 1 })).toBeFocused({ timeout: AFTER_SUBMIT });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Current request");
      await scan(page, `refined (${size.name})`);

      // On to the matches, still by keyboard: Tab to Find people, Enter, Tab to the first person,
      // Enter to open them, Tab to Send request, Enter.
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Find people" })).toBeFocused();
      await page.keyboard.press("Enter");
      const firstRow = page.getByRole("region", { name: "Matches" }).locator("button[aria-expanded]").first();
      await expect(firstRow).toBeVisible({ timeout: AFTER_SUBMIT });
      await tabTo(page, firstRow);
      await page.keyboard.press("Enter");
      await expect(firstRow).toHaveAttribute("aria-expanded", "true");
      await scan(page, `matches (${size.name})`);
      const sending = page.waitForResponse((r) => r.url().endsWith("/api/requests") && r.request().method() === "POST");
      await tabTo(page, page.getByRole("button", { name: "Send request" }));
      await page.keyboard.press("Enter");
      expect((await sending).ok()).toBe(true);
      await page.context().close();
    });
  }

  test("A2: two people — A sends, B accepts and books a time, A marks it answered", async ({ browser, isMobile }) => {
    const size = isMobile ? sizes[0] : sizes[2];
    const a = await asPerson(browser, DEMO_A, size);
    const b = await asPerson(browser, DEMO_B, size);

    // A asks and sends to the expert.
    await a.goto("/ask");
    await a.getByRole("textbox", { name: "What do you want to ask?" }).fill(QUESTION);
    await a.getByRole("button", { name: "Send", exact: true }).click();
    const question = (await a.locator("blockquote").textContent())!.trim();
    await a.getByRole("link", { name: "Find people" }).click();
    const firstRow = a.getByRole("region", { name: "Matches" }).locator("button[aria-expanded]").first();
    await expect(firstRow).toContainText("Demo Expert", { timeout: AFTER_SUBMIT });
    await firstRow.click();
    const cardA = a.getByRole("region", { name: "Matches" }).getByRole("region");
    await expect(cardA.getByRole("heading", { level: 2 })).toHaveText("Demo Expert");
    await expect(cardA).toContainText("Maintains pkg/scheduler/framework/preemption");
    const sending = a.waitForResponse((r) => r.url().endsWith("/api/requests") && r.request().method() === "POST");
    await a.getByRole("button", { name: /^Send request/ }).click();
    const request = await (await sending).json();
    expect(request.toPersonId).toBe(DEMO_B);

    // B sees the question first, accepts, and books the first shared time.
    await b.goto("/inbox");
    const cardB = b.locator(`article[aria-labelledby="req-${request.id}-q"]`);
    await expect(cardB.getByRole("heading", { level: 2 })).toHaveText(question);
    await scan(b, "inbox");
    await cardB.getByRole("button", { name: "Accept this request" }).click();
    const picker = cardB.getByRole("region", { name: "Pick a time to meet" });
    await expect(picker.getByRole("button", { name: /Book$/ }).first()).toBeVisible();
    await scan(b, "slot picker");
    await picker.getByRole("button", { name: /Book$/ }).first().click();
    await expect(cardB).toContainText("Meeting booked:");
    const inbox = (await (await b.request.get("/api/inbox")).json()) as { id: string; status: string; slot: unknown }[];
    expect(inbox.find((r) => r.id === request.id)).toMatchObject({ status: "scheduled", slot: expect.any(Object) });

    // A marks the ask answered and is offered B's GitHub.
    await a.getByRole("button", { name: "Mark as answered" }).click();
    await expect(a.getByRole("heading", { level: 1 })).toHaveText("Marked as answered");
    await expect(a.getByRole("link", { name: /Demo Expert.*@demo-expert on GitHub/ })).toHaveAttribute("href", "https://github.com/demo-expert");
    await scan(a, "resolved");

    await a.context().close();
    await b.context().close();
  });
});
