import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Step 1, "About you": name, workplace, country and where Convo should look. Fake API. */

/** A form submit on a busy test server can take a few seconds before the redirect. */
const AFTER_SUBMIT = 15_000;

const nameField = (page: Page) => page.getByRole("textbox", { name: "Your name" });
const search = (page: Page) => page.getByRole("combobox", { name: "Search for your workplace" });
const country = (page: Page) => page.getByRole("combobox", { name: "Country" });
const continueButton = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
const consentCookie = async (page: Page) =>
  (await page.context().cookies()).find((c) => c.name === "convo_consent");
const draft = (page: Page) => page.evaluate(() => sessionStorage.getItem("convo_onboarding_draft"));

async function answerAll(page: Page) {
  await nameField(page).fill("Ada Lovelace");
  await search(page).fill("oxford");
  await page
    .getByRole("listbox", { name: "Workplaces" })
    .getByRole("option", { name: /University of Oxford/ })
    .click({ timeout: 10_000 });
}

test.describe("about you (step 1)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signin");
    await expect(nameField(page)).toBeVisible();
  });

  test("home page leads to step 1", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Get started" }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Make your badge");
    await expect(page.getByText("Convo fills it in from your public info such as GitHub.")).toBeVisible();
  });

  test("shows no badge, and offers GitHub with the other sources coming soon", async ({ page }) => {
    await expect(page.locator("[data-badge-stripe]")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toContainText("Step 1 of 4");
    const sources = page.getByRole("group", { name: "Where should we look?" });
    await expect(sources.getByRole("checkbox", { name: /GitHub/ })).toBeChecked();
    await expect(sources.getByRole("checkbox", { name: /Research papers/ })).toBeDisabled();
    await expect(sources.getByRole("checkbox", { name: /CV or LinkedIn/ })).toBeDisabled();
    await expect(sources.getByText("Coming soon")).toHaveCount(2);
    await expect(page.getByText("Your name, username and avatar are always on it.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toHaveCount(0);
  });

  test("Continue with nothing filled in names each missing answer and stays put", async ({ page }) => {
    await continueButton(page).click();
    await expect(page.getByText("Add the name people should see.")).toBeVisible();
    await expect(page.getByText("Choose where you work, or pick Not with an organisation.")).toBeVisible();
    await expect(page.getByText("Choose the country you're based in.")).toBeVisible();
    await expect(nameField(page)).toBeFocused();
    await expect(page).toHaveURL(/\/signin$/);
    expect(await draft(page)).toBeNull();
  });

  test("picking a workplace fills in the country", async ({ page }) => {
    await answerAll(page);
    await expect(country(page)).toHaveValue("GB");
    await expect(page.getByText(/Filled in from your workplace/)).toBeVisible();
  });

  test("a country the user chose is not overwritten by the workplace", async ({ page }) => {
    await country(page).selectOption("US");
    await answerAll(page);
    await expect(country(page)).toHaveValue("US");
  });

  test("GitHub has to stay on for now", async ({ page }) => {
    await answerAll(page);
    await page.getByText("GitHub", { exact: true }).click();
    await expect(page.getByRole("checkbox", { name: /GitHub/ })).not.toBeChecked();
    await continueButton(page).click();
    await expect(page.getByText("For now GitHub is how you sign in, so keep it on.")).toBeVisible();
    await expect(page).toHaveURL(/\/signin$/);
  });

  test("Continue keeps the answers in the tab, saves GitHub consent, and goes to step 2", async ({ page }) => {
    await answerAll(page);
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: AFTER_SUBMIT });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your badge");

    expect(JSON.parse((await draft(page)) ?? "null")).toEqual({
      name: "Ada Lovelace",
      country: "GB",
      workplace: { kind: "org", org: { id: "https://ror.org/052gg0110", name: "University of Oxford", country: "GB" } },
    });
    const consent = await consentCookie(page);
    expect(decodeURIComponent(consent?.value ?? "")).toBe("profile,repos,orgs");
    expect(consent?.httpOnly).toBe(true);
    expect(consent?.sameSite).toBe("Lax");
  });

  test("'Not with an organisation' is enough for the workplace", async ({ page }) => {
    await nameField(page).fill("Grace Hopper");
    await page.getByRole("checkbox", { name: "Not with an organisation" }).check();
    await country(page).selectOption("US");
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: AFTER_SUBMIT });
    expect(JSON.parse((await draft(page)) ?? "null")).toMatchObject({ workplace: { kind: "none" }, country: "US" });
  });

  test("the data note stays tucked behind Your data until asked for", async ({ page }) => {
    const note = page.getByText(/We only use public info and anything you upload/);
    await expect(note).toBeHidden();
    await page.locator("summary", { hasText: "Your data" }).click();
    await expect(note).toBeVisible();
  });

  test("works with the keyboard alone", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await nameField(page).focus();
    await page.keyboard.type("Ada Lovelace");
    await page.keyboard.press("Tab");
    await expect(search(page)).toBeFocused();
    await page.keyboard.type("oxford");
    await expect(page.getByRole("listbox", { name: "Workplaces" }).getByRole("option").first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Enter");
    await expect(country(page)).toHaveValue("GB");
    await continueButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: AFTER_SUBMIT });
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const scan = async (label: string) =>
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, label).toEqual([]);
      await scan("empty");
      await continueButton(page).click();
      await expect(page.getByText("Add the name people should see.")).toBeVisible();
      await page.locator("summary", { hasText: "Your data" }).click();
      await scan("with errors and the data note open");
    });
  }
});
