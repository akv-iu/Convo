import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * Step 2, "Your badge". Runs on the fake API, whose profiles are shared by
 * every test in the server process, so tests that save act as their own
 * fixture person (x-demo-user) and check what the server stored, not only
 * the request sent.
 */

const AFTER_SUBMIT = 15_000;

const continueButton = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
const alertWithText = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });
const isSave = (req: Request) => req.url().endsWith("/api/me") && req.method() === "PUT";
const visibleBadge = (page: Page) =>
  page.locator("[data-badge-stripe]:visible").locator("xpath=ancestor::div[@aria-hidden='true'][1]");
const stripeColour = (page: Page) =>
  page
    .locator("[data-badge-stripe]")
    .evaluateAll((els) => els.filter((el) => el.checkVisibility()).map((el) => getComputedStyle(el).backgroundColor)[0]);

const OXFORD = { id: "https://ror.org/052gg0110", name: "University of Oxford", country: "GB" };

/** Leave step 1's answers in this tab, as step 1 would, then open step 2. */
async function openWithDraft(page: Page, person: string, draft: object = { name: "Ada Lovelace", country: "GB", workplace: { kind: "org", org: OXFORD } }) {
  await page.setExtraHTTPHeaders({ "x-demo-user": person });
  await page.goto("/ask");
  await page.evaluate((d) => sessionStorage.setItem("convo_onboarding_draft", JSON.stringify(d)), draft);
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your badge");
}

async function stored(page: Page, person: string) {
  const res = await page.request.get("/api/me", { headers: { "x-demo-user": person } });
  expect(res.ok()).toBe(true);
  return res.json();
}

test.describe("your badge (step 2)", () => {
  test("shows the card from step 1's answers, with the new wording", async ({ page }) => {
    await openWithDraft(page, "p_003");
    await expect(page.getByText("Three quick answers so you make the right connections.")).toBeVisible();
    const badge = visibleBadge(page);
    await expect(badge).toContainText("Ada Lovelace");
    await expect(badge).toContainText("University of Oxford");
    await expect(badge).toContainText("United Kingdom");
    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toContainText("Step 2 of 4");
  });

  test("hiring, colour and Continue save steps 1 and 2 together, and the server keeps them", async ({ page }) => {
    await openWithDraft(page, "p_004");
    await page.getByText("Yes, I'm hiring", { exact: true }).click();
    await expect(visibleBadge(page)).toContainText("Hiring");
    await page.getByRole("radio", { name: "Lilac" }).check({ force: true });
    await expect.poll(() => stripeColour(page)).toBe("rgb(196, 181, 253)");

    const saving = page.waitForRequest(isSave);
    await continueButton(page).click();
    expect((await saving).postDataJSON()).toEqual({
      name: "Ada Lovelace",
      filters: { country: "GB", rorId: OXFORD.id, hiring: true },
    });
    await expect(page).toHaveURL(/\/onboarding\/free-time$/, { timeout: AFTER_SUBMIT });

    const me = await stored(page, "p_004");
    expect(me.name).toBe("Ada Lovelace");
    expect(me.filters).toEqual({ country: "GB", rorId: OXFORD.id, hiring: true });
    expect(await page.evaluate(() => sessionStorage.getItem("convo_onboarding_draft"))).toBeNull();
    // The colour carries on to step 3's badge.
    await expect.poll(() => stripeColour(page)).toBe("rgb(196, 181, 253)");
  });

  test("Continue without a hiring answer explains it and sends nothing", async ({ page }) => {
    await openWithDraft(page, "p_006", { name: "Elena", country: "CA", workplace: { kind: "none" } });
    // p_006 already has a saved hiring answer, so clear it to test the empty case.
    await page.route("**/api/me", (route) =>
      route.request().method() === "GET" ? route.fulfill({ status: 409, json: { error: "Complete onboarding first." } }) : route.fallback(),
    );
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your badge");
    let saved = false;
    page.on("request", (req) => {
      if (isSave(req)) saved = true;
    });
    await continueButton(page).click();
    await expect(page.getByText("Say whether you're hiring.")).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);
    expect(saved).toBe(false);
  });

  test("without step 1's answers, a saved profile is restored", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-demo-user": "p_002" });
    await page.goto("/onboarding");
    const badge = visibleBadge(page);
    await expect(badge).toContainText("Tomasz Wierzbicki");
    await expect(badge).toContainText("Germany");
    await expect(page.getByRole("radio", { name: /Not right now/ })).toBeChecked();
  });

  test("first-time users without step 1's answers are sent to step 1", async ({ page }) => {
    await page.route("**/api/me", (route) => route.fulfill({ status: 409, json: { error: "Complete onboarding first." } }));
    await page.goto("/onboarding");
    await expect(alertWithText(page)).toHaveText("Start with your name, workplace and country.");
    await expect(page.getByRole("link", { name: "Go to About you" })).toHaveAttribute("href", "/signin");
  });

  test("a failed load is an error with Try again, not an empty form", async ({ page }) => {
    let calls = 0;
    await page.setExtraHTTPHeaders({ "x-demo-user": "p_002" });
    await page.route("**/api/me", (route) => {
      calls++;
      return calls === 1 ? route.fulfill({ status: 503, json: { error: "Storage unavailable" } }) : route.fallback();
    });
    await page.goto("/onboarding");
    await expect(alertWithText(page)).toHaveText("Your details didn't load. Try again in a moment.");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(visibleBadge(page)).toContainText("Tomasz Wierzbicki");
  });

  test("a failed save keeps the choices and shows the server's message", async ({ page }) => {
    await openWithDraft(page, "p_003");
    await page.route("**/api/me", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 503, json: { error: "Profile saved, but search update failed. Retry the same save." } })
        : route.fallback(),
    );
    await page.getByText("Yes, I'm hiring", { exact: true }).click();
    await continueButton(page).click();
    await expect(alertWithText(page)).toHaveText("Profile saved, but search update failed. Retry the same save.");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("radio", { name: /Yes, I'm hiring/ })).toBeChecked();
  });

  test("an expired sign-in on save offers a way back", async ({ page }) => {
    await openWithDraft(page, "p_003");
    await page.route("**/api/me", (route) =>
      route.request().method() === "PUT" ? route.fulfill({ status: 401, json: { error: "sign in first" } }) : route.fallback(),
    );
    await page.getByText("Not right now", { exact: true }).click();
    await continueButton(page).click();
    await expect(alertWithText(page)).toContainText("Your sign-in has expired");
    await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/signin");
  });

  test("show/hide on the card is marked coming soon, not offered as working", async ({ page }) => {
    await openWithDraft(page, "p_003");
    const group = page.getByRole("group", { name: "Show on your badge" });
    await expect(group).toContainText("Coming soon");
    for (const box of await group.getByRole("checkbox").all()) await expect(box).toBeDisabled();
  });

  test("a fresh load shows the saved colour, with one form on the page", async ({ page, baseURL }) => {
    await page.context().addCookies([
      { name: "convo_badge", value: encodeURIComponent(JSON.stringify({ colour: "coral" })), url: baseURL! },
    ]);
    await openWithDraft(page, "p_003");
    await expect.poll(() => stripeColour(page)).toBe("rgb(255, 163, 138)");
    await expect(page.locator("form:visible")).toHaveCount(1);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openWithDraft(page, "p_005");
      const scan = async (label: string) =>
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, label).toEqual([]);
      await scan("loaded");
    });
  }
});
