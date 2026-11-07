import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

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
const SHOW_ALL = { country: true, workplace: true, hiring: true };
const LILAC = "rgb(196, 181, 253)";
const CORAL = "rgb(255, 163, 138)";
const visibilitySwitch = (page: Page, name: string) =>
  page.getByRole("group", { name: "Show on your badge" }).getByRole("switch", { name });

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

/** A second, separate browser (no cookies or session storage), as another device would be. */
async function freshBrowser(browser: Browser, person: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-demo-user": person } });
  return context.newPage();
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
    await expect.poll(() => stripeColour(page)).toBe(LILAC);

    const saving = page.waitForRequest(isSave);
    await continueButton(page).click();
    expect((await saving).postDataJSON()).toEqual({
      name: "Ada Lovelace",
      filters: { country: "GB", rorId: OXFORD.id, hiring: true },
      workplaceName: "University of Oxford",
      badgeColour: "lilac",
      visibility: SHOW_ALL,
    });
    await expect(page).toHaveURL(/\/onboarding\/free-time$/, { timeout: AFTER_SUBMIT });

    const me = await stored(page, "p_004");
    expect(me).toMatchObject({
      name: "Ada Lovelace",
      filters: { country: "GB", rorId: OXFORD.id, hiring: true },
      workplaceName: "University of Oxford",
      badgeColour: "lilac",
      visibility: SHOW_ALL,
    });
    expect(await page.evaluate(() => sessionStorage.getItem("convo_onboarding_draft"))).toBeNull();
    // The colour carries on to step 3's badge.
    await expect.poll(() => stripeColour(page)).toBe(LILAC);
  });

  test("a typed workplace and colour survive a reload and another browser", async ({ page, browser, isMobile }, testInfo) => {
    // One fixture person per project, so the phone and laptop runs can't overwrite each other.
    const person = isMobile ? "p_006" : "p_001";
    const acme = `Acme Robotics ${testInfo.project.name}`;
    await openWithDraft(page, person, { name: "Grace Hopper", country: "US", workplace: { kind: "custom", name: acme } });
    await expect(visibleBadge(page)).toContainText(acme);
    await page.getByText("Not right now", { exact: true }).click();
    await page.getByRole("radio", { name: "Coral" }).check({ force: true });
    const saving = page.waitForRequest(isSave);
    await continueButton(page).click();
    expect((await saving).postDataJSON()).toMatchObject({ filters: { rorId: null }, workplaceName: acme, badgeColour: "coral" });
    await expect(page).toHaveURL(/\/onboarding\/free-time$/, { timeout: AFTER_SUBMIT });
    expect(await stored(page, person)).toMatchObject({ name: "Grace Hopper", workplaceName: acme, badgeColour: "coral" });

    // Same browser, fresh load of step 2 (the draft is gone, so this is the saved profile).
    await page.goto("/onboarding");
    await expect(visibleBadge(page)).toContainText(acme);
    await expect(page.getByRole("radio", { name: "Coral" })).toBeChecked();

    // Another browser: no draft and no colour cookie, only the saved profile.
    const other = await freshBrowser(browser, person);
    await other.goto("/onboarding");
    await expect(visibleBadge(other)).toContainText(acme);
    await expect(visibleBadge(other)).toContainText("Grace Hopper");
    await expect(other.getByRole("radio", { name: "Coral" })).toBeChecked();
    await expect.poll(() => stripeColour(other)).toBe(CORAL);
    await other.goto("/onboarding/profile");
    await expect.poll(() => stripeColour(other)).toBe(CORAL);
    await other.context().close();
  });

  test("hiding sections saves the whole visibility object, and it's restored", async ({ page, isMobile }) => {
    // A returning user (no draft), so the save writes back their own details and only visibility changes.
    const person = isMobile ? "p_005" : "p_003";
    const reset = () => page.request.put("/api/me", { headers: { "x-demo-user": person }, data: { visibility: SHOW_ALL } });
    expect((await reset()).ok()).toBe(true);
    await page.setExtraHTTPHeaders({ "x-demo-user": person });
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your badge");
    const before = await stored(page, person);
    await expect(visibilitySwitch(page, "Country")).toBeChecked();
    await visibilitySwitch(page, "Country").uncheck({ force: true });
    await visibilitySwitch(page, "Hiring status").uncheck({ force: true });
    await expect(page.getByRole("group", { name: "Show on your badge" })).toContainText("Hidden");

    const saving = page.waitForRequest(isSave);
    await continueButton(page).click();
    const hidden = { country: false, workplace: true, hiring: false };
    expect((await saving).postDataJSON().visibility).toEqual(hidden);
    await expect(page).toHaveURL(/\/onboarding\/free-time$/, { timeout: AFTER_SUBMIT });
    const after = await stored(page, person);
    expect(after.visibility).toEqual(hidden);
    // Nothing else about them changed (an older profile's missing workplace name stays missing).
    for (const key of ["name", "filters", "workplaceName", "badgeColour"]) expect(after[key], key).toEqual(before[key]);

    await page.goto("/onboarding");
    await expect(visibilitySwitch(page, "Country")).not.toBeChecked();
    await expect(visibilitySwitch(page, "Workplace")).toBeChecked();
    await expect(visibilitySwitch(page, "Hiring status")).not.toBeChecked();
    expect((await reset()).ok()).toBe(true);
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

  test("the saved profile's colour wins over this browser's preview cookie", async ({ page, baseURL }) => {
    await page.context().addCookies([
      { name: "convo_badge", value: encodeURIComponent(JSON.stringify({ colour: "coral" })), url: baseURL! },
    ]);
    // A saved lilac profile, without changing the shared fake.
    await page.route("**/api/me", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const res = await route.fetch();
      return route.fulfill({ response: res, json: { ...(await res.json()), badgeColour: "lilac" } });
    });
    await openWithDraft(page, "p_003");
    await expect(page.getByRole("radio", { name: "Lilac" })).toBeChecked();
    await expect.poll(() => stripeColour(page)).toBe(LILAC);
    await expect(page.locator("form:visible")).toHaveCount(1);
    const cookie = (await page.context().cookies()).find((c) => c.name === "convo_badge");
    expect(JSON.parse(decodeURIComponent(cookie?.value ?? "{}"))).toEqual({ colour: "lilac" });
  });

  test("before there is a saved profile, the preview cookie's colour is used", async ({ page, baseURL }) => {
    await page.context().addCookies([
      { name: "convo_badge", value: encodeURIComponent(JSON.stringify({ colour: "coral" })), url: baseURL! },
    ]);
    await page.route("**/api/me", (route) =>
      route.request().method() === "GET" ? route.fulfill({ status: 409, json: { error: "Complete onboarding first." } }) : route.fallback(),
    );
    await openWithDraft(page, "p_003");
    await expect(page.getByRole("radio", { name: "Coral" })).toBeChecked();
    await expect.poll(() => stripeColour(page)).toBe(CORAL);
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
