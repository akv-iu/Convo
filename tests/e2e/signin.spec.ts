import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** A form submit on a busy test server can take a few seconds before the redirect. */
const AFTER_SUBMIT = 15_000;

const consentCookie = async (page: Page) =>
  (await page.context().cookies()).find((c) => c.name === "convo_consent");

/** The frontend-only badge preferences cookie, decoded. */
const badgeCookie = async (page: Page) => {
  const raw = (await page.context().cookies()).find((c) => c.name === "convo_badge")?.value;
  return raw ? (JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>) : undefined;
};

/** Background colour of the badge stripe that's on screen (phone and laptop each have one). */
const stripeColour = (page: Page) =>
  page
    .locator("[data-badge-stripe]")
    .evaluateAll((els) => els.filter((el) => el.checkVisibility()).map((el) => getComputedStyle(el).backgroundColor)[0]);

/**
 * Height of a badge row's clipping box, found by its caption; 0 when the row
 * is folded away. offsetHeight ignores the laptop badge's tilt, which would
 * otherwise give a zero-height row a non-zero on-screen box. Max over both
 * badges, as one is always display:none.
 */
const badgeRowHeight = (page: Page, caption: string) =>
  page
    .getByText(caption, { exact: true })
    .evaluateAll((els) =>
      Math.max(...els.map((el) => (el.closest(".overflow-hidden") as HTMLElement | null)?.offsetHeight ?? 0)),
    );

test.describe("sign-in and consent (A1 step 1)", () => {
  test("home page leads to sign-in", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Get started" }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Make your badge");
  });

  test("every source is offered and switched on to start with", async ({ page }) => {
    await page.goto("/signin");
    const sources = page.getByRole("group", { name: "What goes on your badge" }).getByRole("checkbox");
    await expect(sources).toHaveCount(3);
    for (const box of await sources.all()) await expect(box).toBeChecked();
    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toContainText("Step 1 of 4");
  });

  test("tapping a tile switches the source off and folds its row on the badge", async ({ page }) => {
    await page.goto("/signin");
    expect(await badgeRowHeight(page, "Can help with")).toBeGreaterThan(0);

    await page.getByText("Repos and languages", { exact: true }).click();
    await expect(page.getByRole("checkbox", { name: /Repos and languages/ })).not.toBeChecked();
    await expect.poll(() => badgeRowHeight(page, "Can help with")).toBe(0);

    await page.getByText("Repos and languages", { exact: true }).click();
    await expect.poll(() => badgeRowHeight(page, "Can help with")).toBeGreaterThan(0);
  });

  test("switched-off sources are left out of the saved consent", async ({ page }) => {
    await page.goto("/signin");
    await page.getByText("Organisations", { exact: true }).click();
    await page.getByRole("button", { name: "Continue with GitHub" }).click();

    await expect(page).toHaveURL(/\/onboarding$/, { timeout: AFTER_SUBMIT });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About you");
    const consent = await consentCookie(page);
    expect(decodeURIComponent(consent?.value ?? "")).toBe("profile,repos");
    expect(consent?.httpOnly).toBe(true);
    expect(consent?.sameSite).toBe("Lax");
    expect(consent?.path).toBe("/");
  });

  test("switching everything off saves an empty consent (identity only)", async ({ page }) => {
    await page.goto("/signin");
    for (const label of ["Bio", "Repos and languages", "Organisations"]) {
      await page.getByText(label, { exact: true }).click();
    }
    await page.getByRole("button", { name: "Continue with GitHub" }).click();

    await expect(page).toHaveURL(/\/onboarding$/, { timeout: AFTER_SUBMIT });
    const consent = await consentCookie(page);
    expect(consent).toBeDefined();
    expect(consent?.value).toBe("");
  });

  test("works with the keyboard alone", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await page.goto("/signin");
    const repos = page.getByRole("checkbox", { name: /Repos and languages/ });
    await repos.focus();
    await page.keyboard.press("Space");
    await expect(repos).not.toBeChecked();

    await page.keyboard.press("Tab"); // organisations
    await page.keyboard.press("Tab"); // colour swatches (one tab stop for the group)
    await expect(page.getByRole("radio", { name: "Sunflower" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Mint" })).toBeChecked();
    await page.keyboard.press("Tab"); // continue
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/onboarding$/, { timeout: AFTER_SUBMIT });
    expect(decodeURIComponent((await consentCookie(page))?.value ?? "")).toBe("profile,orgs");
    expect(await badgeCookie(page)).toMatchObject({ colour: "mint" });
  });

  test("the colour picker recolours the badge and is saved", async ({ page }) => {
    await page.goto("/signin");
    const swatches = page.getByRole("group", { name: "Badge colour" }).getByRole("radio");
    await expect(swatches).toHaveCount(5);
    await expect(page.getByRole("radio", { name: "Sunflower" })).toBeChecked();
    await expect.poll(() => stripeColour(page)).toBe("rgb(255, 210, 63)");

    await page.getByRole("radio", { name: "Lilac" }).check({ force: true });
    await expect.poll(() => stripeColour(page)).toBe("rgb(196, 181, 253)");

    await page.getByRole("button", { name: "Continue with GitHub" }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: AFTER_SUBMIT });
    const saved = (await page.context().cookies()).find((c) => c.name === "convo_badge");
    expect(saved?.httpOnly).toBe(false); // read by later screens in the browser
    expect(await badgeCookie(page)).toMatchObject({ colour: "lilac" });
  });

  test("tapping a badge row switches that source off, and its stub brings it back", async ({ page }) => {
    await page.goto("/signin");
    const repos = page.getByRole("checkbox", { name: /Repos and languages/ });
    const visibleBadge = page.locator("[data-badge-stripe]:visible").locator("xpath=ancestor::div[@aria-hidden='true'][1]");

    await visibleBadge.getByText("Can help with", { exact: true }).click();
    await expect(repos).not.toBeChecked();
    await expect.poll(() => badgeRowHeight(page, "Can help with")).toBe(0);

    await visibleBadge.getByText("+ Repos", { exact: true }).click();
    await expect(repos).toBeChecked();
    await expect.poll(() => badgeRowHeight(page, "Can help with")).toBeGreaterThan(0);
    await expect(visibleBadge.getByText("+ Repos", { exact: true })).toBeHidden();
  });

  test("the data note stays tucked behind Your data until asked for", async ({ page }) => {
    await page.goto("/signin");
    const note = page.getByText(/Public data only, and nothing is posted to GitHub/);
    await expect(note).toBeHidden();
    await page.locator("summary", { hasText: "Your data" }).click();
    await expect(note).toBeVisible();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const scan = async (label: string) =>
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, label).toEqual([]);

      await page.goto("/signin");
      await scan("/signin");
      await page.locator("summary", { hasText: "Your data" }).click();
      await page.getByText("Repos and languages", { exact: true }).click(); // a stub showing
      await expect.poll(() => badgeRowHeight(page, "Can help with")).toBe(0);
      await scan("/signin with the data note open and a source off");
      await page.goto("/onboarding");
      await scan("/onboarding");
    });
  }
});
