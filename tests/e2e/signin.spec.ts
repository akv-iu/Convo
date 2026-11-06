import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const consentCookie = async (page: Page) =>
  (await page.context().cookies()).find((c) => c.name === "convo_consent");

/**
 * Height of a badge row, found by its caption; 0 when the row is folded away.
 * offsetHeight ignores the laptop badge's tilt, which would otherwise give a
 * zero-height row a non-zero on-screen box. Max over both badges, as one is
 * always display:none.
 */
const badgeRowHeight = (page: Page, caption: string) =>
  page
    .getByText(caption, { exact: true })
    .locator("..")
    .evaluateAll((els) => Math.max(...els.map((el) => (el as HTMLElement).offsetHeight)));

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

    await expect(page).toHaveURL(/\/onboarding$/);
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

    await expect(page).toHaveURL(/\/onboarding$/);
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
    await page.keyboard.press("Tab"); // continue
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/onboarding$/);
    expect(decodeURIComponent((await consentCookie(page))?.value ?? "")).toBe("profile,orgs");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of ["/signin", "/onboarding"]) {
        await page.goto(path);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        expect(results.violations, path).toEqual([]);
      }
    });
  }
});
