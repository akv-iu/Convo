import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * Step 3: free times. Runs on the fake API, whose profiles are shared by
 * every test in the server process, so each test acts as a different
 * fixture person (x-demo-user). Saves are checked by what the server
 * stored (read back with GET and after a reload), not only by the request.
 */

const AFTER_SUBMIT = 15_000;

const isSave = (req: Request) => req.url().endsWith("/api/availability") && req.method() === "PUT";
const finish = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
const block = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true });
/** Labels of the blocks that are switched on, in order. */
const pickedLabels = (page: Page) =>
  page.getByRole("group", { name: /half-hour blocks/ }).locator("button[aria-pressed=true]").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
const alertWithText = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

async function open(page: Page, person: string) {
  await page.setExtraHTTPHeaders({ "x-demo-user": person });
  await page.goto("/onboarding/free-time");
  await expect(finish(page)).toBeVisible();
}

/** Give a test a known starting point: earlier runs (phone, laptop, retries) share the fake's state. */
async function seed(page: Page, person: string, times: { start: string; end: string }[]) {
  const res = await page.request.put("/api/availability", { headers: { "x-demo-user": person }, data: times });
  expect(res.ok()).toBe(true);
}

const NINE_TO_TEN = [{ start: "2026-11-09T09:00:00-07:00", end: "2026-11-09T10:00:00-07:00" }];

async function stored(page: Page, person: string) {
  const res = await page.request.get("/api/availability", { headers: { "x-demo-user": person } });
  expect(res.ok()).toBe(true);
  return res.json();
}

test.describe("free time (A1 step 4)", () => {
  test("shows the times already saved", async ({ page }) => {
    await open(page, "p_002"); // fixture: 9:00-9:30 and 4:30-5:00
    await expect.poll(() => pickedLabels(page)).toEqual(["9:00 AM to 9:30 AM", "4:30 PM to 5:00 PM"]);
    await expect(page.getByRole("status").filter({ hasText: "1 hour" })).toContainText("9:00 AM – 9:30 AM, 4:30 PM – 5:00 PM");
    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toContainText("Step 3 of 4");
  });

  test("picks are saved as joined ranges, stored, and still there after a reload", async ({ page }) => {
    await seed(page, "p_004", NINE_TO_TEN);
    await open(page, "p_004");
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: /^Morning/ }).click();
    await expect(page.getByRole("button", { name: /^Morning/ })).toHaveAttribute("aria-pressed", "true");
    await block(page, "2:00 PM to 2:30 PM").click();
    await block(page, "2:30 PM to 3:00 PM").click();
    await expect(page.getByRole("status").filter({ hasText: "4 hours" })).toContainText("9:00 AM – 12:00 PM, 2:00 PM – 3:00 PM");

    const expected = [
      { start: "2026-11-09T09:00:00-07:00", end: "2026-11-09T12:00:00-07:00" },
      { start: "2026-11-09T14:00:00-07:00", end: "2026-11-09T15:00:00-07:00" },
    ];
    const saving = page.waitForRequest(isSave);
    await finish(page).click();
    expect((await saving).postDataJSON()).toEqual(expected);
    await expect(page).toHaveURL(/\/onboarding\/profile$/, { timeout: AFTER_SUBMIT });

    expect(await stored(page, "p_004")).toEqual(expected);
    await page.goto("/onboarding/free-time");
    await expect(finish(page)).toBeVisible();
    await expect.poll(() => pickedLabels(page)).toHaveLength(8);
  });

  test("Clear then Continue saves no free times", async ({ page }) => {
    await seed(page, "p_006", NINE_TO_TEN);
    await open(page, "p_006");
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("People can't book a time with you until you add some.")).toBeVisible();
    const saving = page.waitForRequest(isSave);
    await finish(page).click();
    expect((await saving).postDataJSON()).toEqual([]);
    await expect(page).toHaveURL(/\/onboarding\/profile$/, { timeout: AFTER_SUBMIT });
    expect(await stored(page, "p_006")).toEqual([]);
  });

  test("continuing without changes sends nothing", async ({ page }) => {
    await open(page, "p_001");
    let saved = false;
    page.on("request", (req) => {
      if (isSave(req)) saved = true;
    });
    await finish(page).click();
    await expect(page).toHaveURL(/\/onboarding\/profile$/, { timeout: AFTER_SUBMIT });
    expect(saved).toBe(false);
  });

  test("a quick pick that is fully on switches off on a second tap", async ({ page }) => {
    await seed(page, "p_005", NINE_TO_TEN);
    await open(page, "p_005");
    await page.getByRole("button", { name: "Clear" }).click();
    const lunch = page.getByRole("button", { name: /^Lunch/ });
    await lunch.click();
    await expect.poll(() => pickedLabels(page)).toHaveLength(3);
    await lunch.click();
    await expect.poll(() => pickedLabels(page)).toHaveLength(0);
  });

  test("blocks work with the keyboard", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await open(page, "p_003");
    const ten = block(page, "10:00 AM to 10:30 AM");
    const before = await ten.getAttribute("aria-pressed");
    await ten.focus();
    await page.keyboard.press("Space");
    await expect(ten).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
    await page.keyboard.press("Enter");
    await expect(ten).toHaveAttribute("aria-pressed", before ?? "false");
  });

  test("a failed load can be retried", async ({ page }) => {
    let calls = 0;
    await page.setExtraHTTPHeaders({ "x-demo-user": "p_002" });
    await page.route("**/api/availability", (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      calls++;
      return calls === 1 ? route.fulfill({ status: 503, json: { error: "Storage unavailable" } }) : route.fallback();
    });
    await page.goto("/onboarding/free-time");
    await expect(alertWithText(page)).toHaveText("Your free times didn't load. Try again in a moment.");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => pickedLabels(page)).toContain("9:00 AM to 9:30 AM");
  });

  test("an expired sign-in on load offers sign-in", async ({ page }) => {
    await page.route("**/api/availability", (route) =>
      route.fulfill({ status: 401, json: { error: "sign in first" } }),
    );
    await page.goto("/onboarding/free-time");
    await expect(alertWithText(page)).toHaveText("Your sign-in has expired.");
    await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/signin");
  });

  test("a failed save keeps the picks and shows the server's message", async ({ page }) => {
    await open(page, "p_003");
    await page.route("**/api/availability", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 503, json: { error: "Profile saved, but search update failed. Retry the same save." } })
        : route.fallback(),
    );
    await block(page, "5:30 PM to 6:00 PM").click();
    await expect.poll(() => pickedLabels(page)).toContain("5:30 PM to 6:00 PM");
    const picks = await pickedLabels(page);
    await finish(page).click();
    await expect(alertWithText(page)).toHaveText("Profile saved, but search update failed. Retry the same save.");
    await expect(page).toHaveURL(/\/onboarding\/free-time$/);
    await expect.poll(() => pickedLabels(page)).toEqual(picks);
    await expect(finish(page)).toBeEnabled();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, "p_002");
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, "loaded").toEqual([]);
      await page.goto("/ask");
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, "ask placeholder").toEqual([]);
    });
  }
});
