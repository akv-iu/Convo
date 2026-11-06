import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("sign-in and consent (A1 step 1)", () => {
  test("home page leads to sign-in", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Get started" }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to Convo");
  });

  test("every source is offered and ticked to start with", async ({ page }) => {
    await page.goto("/signin");
    const sources = page.getByRole("group", { name: "What Convo may import from GitHub" }).getByRole("checkbox");
    await expect(sources).toHaveCount(3);
    for (const box of await sources.all()) await expect(box).toBeChecked();
    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toContainText("Step 1 of 4");
  });

  test("unticked sources are left out of the saved consent", async ({ page, context }) => {
    await page.goto("/signin");
    await page.getByRole("checkbox", { name: "Organisations you publicly belong to" }).uncheck();
    await page.getByRole("button", { name: "Continue with GitHub" }).click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About you");
    const consent = (await context.cookies()).find((c) => c.name === "convo_consent");
    expect(decodeURIComponent(consent?.value ?? "")).toBe("profile,repos");
    expect(consent?.httpOnly).toBe(true);
    expect(consent?.sameSite).toBe("Lax");
    expect(consent?.path).toBe("/");
  });

  test("unticking everything saves an empty consent (identity only)", async ({ page, context }) => {
    await page.goto("/signin");
    for (const box of await page.getByRole("checkbox").all()) await box.uncheck();
    await page.getByRole("button", { name: "Continue with GitHub" }).click();

    await expect(page).toHaveURL(/\/onboarding$/);
    const consent = (await context.cookies()).find((c) => c.name === "convo_consent");
    expect(consent).toBeDefined();
    expect(consent?.value).toBe("");
  });

  test("works with the keyboard alone", async ({ page, context, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await page.goto("/signin");
    const repos = page.getByRole("checkbox", { name: "Your public repositories and their languages" });
    await repos.focus();
    await page.keyboard.press("Space");
    await expect(repos).not.toBeChecked();

    await page.keyboard.press("Tab"); // organisations
    await page.keyboard.press("Tab"); // continue
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/onboarding$/);
    const consent = (await context.cookies()).find((c) => c.name === "convo_consent");
    expect(decodeURIComponent(consent?.value ?? "")).toBe("profile,orgs");
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
