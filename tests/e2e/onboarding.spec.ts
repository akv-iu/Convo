import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * A1 step 2: the three onboarding questions. Runs on the fake API. The
 * fake's state is shared by every test in the server process, so saves are
 * checked by the request this screen sends, not by reading the profile back.
 */

const search = (page: Page) => page.getByRole("combobox", { name: "Search for your workplace" });
const country = (page: Page) => page.getByRole("combobox", { name: "Country" });
const continueButton = (page: Page) => page.getByRole("button", { name: "Continue" });
/** The save error; Next.js also renders an empty role="alert" route announcer. */
const saveAlert = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

function savedFilters(req: Request) {
  return (req.postDataJSON() as { filters: unknown }).filters;
}

const isSave = (req: Request) => req.url().endsWith("/api/me") && req.method() === "PUT";

/** A save then a client-side move on a busy test server can take a few seconds. */
const AFTER_SUBMIT = 15_000;

/** The frontend-only badge preferences cookie, decoded. */
const badgeCookie = async (page: Page) => {
  const raw = (await page.context().cookies()).find((c) => c.name === "convo_badge")?.value;
  return raw ? (JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>) : undefined;
};

/** Background colour of the badge stripe that's on screen. */
const stripeColour = (page: Page) =>
  page
    .locator("[data-badge-stripe]")
    .evaluateAll((els) => els.filter((el) => el.checkVisibility()).map((el) => getComputedStyle(el).backgroundColor)[0]);

test.describe("about you (A1 step 2)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About you");
  });

  test("picking a workplace fills in the country, and the answers save together", async ({ page }) => {
    await search(page).fill("stan");
    await page.getByRole("option", { name: /Stanford University/ }).click();
    await expect(page.getByText("Stanford University", { exact: true }).first()).toBeVisible();
    await expect(country(page)).toHaveValue("US");

    await page.getByText("Not right now", { exact: true }).click();
    const saving = page.waitForRequest(isSave);
    await continueButton(page).click();

    expect(savedFilters(await saving)).toEqual({ country: "US", rorId: "https://ror.org/00f54p054", hiring: false });
    await expect(page).toHaveURL(/\/onboarding\/profile$/, { timeout: AFTER_SUBMIT });
    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toContainText("Step 3 of 4");
  });

  test("a workplace not in the directory can be typed in", async ({ page }) => {
    await search(page).fill("Acme Robotics");
    await expect(page.getByText("No match in the directory.")).toBeVisible();
    const useTyped = page.getByRole("option", { name: /Use “Acme Robotics”/ });
    await expect(useTyped).toHaveAttribute("aria-selected", "true");
    await useTyped.click();

    await expect(page.getByText("Not in the directory")).toBeVisible();
    await expect(page.getByRole("button", { name: "Change workplace" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Not with an organisation" })).toHaveCount(0);

    await country(page).selectOption("GB");
    await page.getByText("Yes, I'm hiring", { exact: true }).click();
    const saving = page.waitForRequest(isSave);
    await continueButton(page).click();

    expect(savedFilters(await saving)).toEqual({ country: "GB", rorId: null, hiring: true });
    await expect(page).toHaveURL(/\/onboarding\/profile$/, { timeout: AFTER_SUBMIT });
    expect(await badgeCookie(page)).toMatchObject({ workplace: "Acme Robotics" });
  });

  test("the badge keeps the colour chosen in step 1", async ({ page, baseURL }) => {
    await page.context().addCookies([
      { name: "convo_badge", value: encodeURIComponent(JSON.stringify({ colour: "coral" })), url: baseURL! },
    ]);
    await page.goto("/onboarding");
    await expect.poll(() => stripeColour(page)).toBe("rgb(255, 163, 138)");
    await expect(page.locator("form")).toHaveCount(1);
  });

  test("'Not with an organisation' saves no workplace", async ({ page }) => {
    await page.getByRole("checkbox", { name: "Not with an organisation" }).check();
    await expect(search(page)).toBeDisabled();
    await country(page).selectOption("CA");
    await page.getByText("Yes, I'm hiring", { exact: true }).click();

    const saving = page.waitForRequest(isSave);
    await continueButton(page).click();
    expect(savedFilters(await saving)).toEqual({ country: "CA", rorId: null, hiring: true });
  });

  test("a country the user chose is not overwritten by the workplace", async ({ page }) => {
    await country(page).selectOption("GB");
    await search(page).fill("stan");
    await page.getByRole("option", { name: /Stanford University/ }).click();
    await expect(country(page)).toHaveValue("GB");
  });

  test("Change clears the workplace and returns to the search", async ({ page }) => {
    await search(page).fill("oxford");
    await page.getByRole("option", { name: /University of Oxford/ }).click();
    await page.getByRole("button", { name: "Change workplace" }).click();
    await expect(search(page)).toBeFocused();
    await expect(search(page)).toHaveValue("");
  });

  test("Continue with nothing answered explains each question and sends nothing", async ({ page }) => {
    let saved = false;
    page.on("request", (req) => {
      if (isSave(req)) saved = true;
    });
    await continueButton(page).click();

    await expect(page.getByText("Choose where you work, or pick Not with an organisation.")).toBeVisible();
    await expect(page.getByText("Choose the country you're based in.")).toBeVisible();
    await expect(page.getByText("Say whether you're hiring.")).toBeVisible();
    await expect(search(page)).toBeFocused();
    await expect(page).toHaveURL(/\/onboarding$/);
    expect(saved).toBe(false);
  });

  test("the workplace list works with the keyboard", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await search(page).focus();
    await page.keyboard.type("univ");
    await expect(page.getByRole("option").first()).toBeVisible();
    await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
    const second = (await page.getByRole("option").nth(1).locator("span").first().textContent()) ?? "";
    await page.keyboard.press("Enter");
    await expect(page.getByText(second, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });

  test("a failing workplace search shows an error, not 'no workplaces'", async ({ page }) => {
    await page.route("**/api/ror?**", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "ROR unavailable" }) }),
    );
    await search(page).fill("stan");
    await expect(page.getByRole("listbox")).toContainText("Workplace search isn't responding right now");
    await expect(page.getByRole("listbox")).not.toContainText("No workplaces match");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("a slow reply for older typing is ignored", async ({ page }) => {
    await page.route("**/api/ror?**", async (route) => {
      const q = new URL(route.request().url()).searchParams.get("q");
      if (q === "stan") {
        await new Promise((r) => setTimeout(r, 1500));
        return route.fulfill({ json: [{ id: "https://ror.org/00f54p054", name: "Stanford University", country: "US" }] });
      }
      return route.fulfill({ json: [{ id: "https://ror.org/052gg0110", name: "University of Oxford", country: "GB" }] });
    });
    await search(page).fill("stan");
    await page.waitForRequest((r) => r.url().includes("q=stan"));
    await search(page).fill("oxford");

    await expect(page.getByRole("option", { name: /University of Oxford/ })).toBeVisible();
    await page.waitForTimeout(1700);
    await expect(page.getByRole("option", { name: /Stanford/ })).toHaveCount(0);
  });

  test("the search box stops at 200 characters", async ({ page }) => {
    await search(page).fill("x".repeat(250));
    await expect(search(page)).toHaveValue("x".repeat(200));
  });

  test("a failed save keeps the answers and shows the server's message", async ({ page }) => {
    await page.route("**/api/me", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Profile saved, but search wasn't updated. Retry the same save." }),
          })
        : route.fallback(),
    );
    await page.getByRole("checkbox", { name: "Not with an organisation" }).check();
    await country(page).selectOption("US");
    await page.getByText("Not right now", { exact: true }).click();
    await continueButton(page).click();

    await expect(saveAlert(page)).toHaveText("Profile saved, but search wasn't updated. Retry the same save.");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(country(page)).toHaveValue("US");
    await expect(continueButton(page)).toBeEnabled();
  });

  test("an expired sign-in offers a way back to sign in", async ({ page }) => {
    await page.route("**/api/me", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "sign in first" }) })
        : route.fallback(),
    );
    await page.getByRole("checkbox", { name: "Not with an organisation" }).check();
    await country(page).selectOption("US");
    await page.getByText("Not right now", { exact: true }).click();
    await continueButton(page).click();

    await expect(saveAlert(page)).toContainText("Your sign-in has expired");
    await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/signin");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/onboarding");
      const scan = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

      expect((await scan()).violations, "empty form").toEqual([]);

      await continueButton(page).click(); // errors showing
      expect((await scan()).violations, "with errors").toEqual([]);

      await search(page).fill("univ"); // list open
      await expect(page.getByRole("option").first()).toBeVisible();
      expect((await scan()).violations, "with results").toEqual([]);

      await page.goto("/onboarding/profile");
      expect((await scan()).violations, "step 3 placeholder").toEqual([]);
    });
  }
});
