import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * "Where do you work?" search, now on step 1 (/signin). These tests moved
 * here unchanged from the old step 2 file, including Person B's fixes from
 * PR #11 (stale selection, listbox only with options, scroll into view,
 * blur, Enter, retry focus).
 */

const search = (page: Page) => page.getByRole("combobox", { name: "Search for your workplace" });
const country = (page: Page) => page.getByRole("combobox", { name: "Country" });

test.describe("workplace search (step 1)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signin");
    await expect(search(page)).toBeVisible();
  });

  test("Change clears the workplace and returns to the search", async ({ page }) => {
    await search(page).fill("oxford");
    await page.getByRole("option", { name: /University of Oxford/ }).click();
    await page.getByRole("button", { name: "Change workplace" }).click();
    await expect(search(page)).toBeFocused();
    await expect(search(page)).toHaveValue("");
  });

  test("the workplace list works with the keyboard", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await search(page).focus();
    await page.keyboard.type("univ");
    // Scoped to the workplace list: the country <select>'s options also have role "option".
    const options = page.getByRole("listbox", { name: "Workplaces" }).getByRole("option");
    await expect(options.first()).toBeVisible({ timeout: 10_000 });
    await expect(options.first()).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    const second = (await options.nth(1).locator("span").first().textContent()) ?? "";
    await page.keyboard.press("Enter");
    await expect(page.getByText(second, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });

  test("a failing workplace search shows an error, not 'no workplaces'", async ({ page }) => {
    await page.route("**/api/ror?**", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "ROR unavailable" }) }),
    );
    await search(page).fill("stan");
    await expect(page.getByRole("status")).toContainText("Workplace search isn't responding right now");
    await expect(page.getByRole("status")).not.toContainText("No workplaces match");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("a signed-out search (real API before sign-in) explains what to do", async ({ page }) => {
    await page.route("**/api/ror?**", (route) => route.fulfill({ status: 401, json: { error: "sign in first" } }));
    await search(page).fill("stan");
    await expect(page.getByRole("status")).toContainText("Workplace search isn't available yet. Use the name as you typed it");
    await page.getByRole("button", { name: /Use .stan./ }).click();
    await expect(page.getByText("Added by you")).toBeVisible();
  });

  test("no matches offers the name as typed, and Enter uses it", async ({ page }) => {
    await page.route("**/api/ror?**", (route) => route.fulfill({ json: [] }));
    await search(page).fill("Tiny Startup");
    await expect(page.getByRole("status")).toContainText("No workplaces match");
    await expect(page.getByRole("option", { name: /Use .Tiny Startup./ })).toHaveAttribute("aria-selected", "true");
    await search(page).press("Enter");
    await expect(page.getByText("Tiny Startup", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Change workplace" }).click();
    await expect(search(page)).toBeFocused();
  });

  test("typing a listed workplace's exact name doesn't also offer it as typed", async ({ page }) => {
    await search(page).fill("university of oxford");
    const options = page.getByRole("listbox", { name: "Workplaces" }).getByRole("option");
    await expect(options.first()).toContainText("University of Oxford");
    await expect(page.getByRole("option", { name: /^Use / })).toHaveCount(0);
  });

  test("the name as typed is the last option after real matches", async ({ page }) => {
    await search(page).fill("oxford");
    const options = page.getByRole("listbox", { name: "Workplaces" }).getByRole("option");
    await expect(options.first()).toContainText("University of Oxford");
    await expect(options.last()).toContainText("Use “oxford”");
  });

  test("changing a completed search cannot select its old result during debounce", async ({ page }) => {
    await search(page).fill("stan");
    await expect(page.getByRole("option", { name: /Stanford/ })).toBeVisible();
    await page.clock.install();
    await page.clock.pauseAt(new Date());

    await search(page).fill("oxford");
    await search(page).press("Enter");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change workplace" })).toHaveCount(0);
    await expect(country(page)).toHaveValue("");

    await page.clock.runFor(350);
    await page.clock.resume();
    await page.getByRole("option", { name: /University of Oxford/ }).click();
    await expect(country(page)).toHaveValue("GB");
  });

  test("adding whitespace preserves results for the same search", async ({ page }) => {
    await search(page).fill("stan");
    await expect(page.getByRole("option", { name: /Stanford/ })).toBeVisible();
    await search(page).fill(" stan ");
    await search(page).press("Enter");
    await expect(country(page)).toHaveValue("US");
  });

  test("keyboard navigation keeps the last workplace visible and closes on leaving", async ({ page }) => {
    await search(page).fill("univ");
    const list = page.getByRole("listbox");
    const options = list.getByRole("option");
    await expect(options.first()).toBeVisible();
    const count = await options.count();
    for (let i = 1; i < count; i++) await search(page).press("ArrowDown");
    await expect(options.last()).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(async () =>
        options.last().evaluate((el) => {
          const item = el.getBoundingClientRect();
          const list = el.parentElement!.getBoundingClientRect();
          return item.top >= list.top && item.bottom <= list.bottom;
        }),
      )
      .toBe(true);
    await search(page).press("Tab");
    await expect(list).toHaveCount(0);
  });

  test("keyboard retry keeps focus inside the search and recovers", async ({ page }) => {
    let attempts = 0;
    await page.route("**/api/ror?**", (route) => {
      attempts++;
      return attempts === 1
        ? route.fulfill({ status: 503, json: { error: "ROR unavailable" } })
        : route.fulfill({ json: [{ id: "https://ror.org/00f54p054", name: "Stanford University", country: "US" }] });
    });
    await search(page).fill("stan");
    const retry = page.getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible();
    await search(page).press("Tab");
    await expect(retry).toBeFocused();
    await page.waitForTimeout(250); // The old blur timer removed the focused button after 150 ms.
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(search(page)).toBeFocused();
    await expect(page.getByRole("option", { name: /Stanford/ })).toBeVisible();
    expect(attempts).toBe(2);
    await search(page).press("Enter");
    await expect(country(page)).toHaveValue("US");
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

  for (const scheme of ["light", "dark"] as const) {
    test(`search loading, empty and error states are accessible in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      let releaseSearch: () => void = () => {};
      const pending = new Promise<void>((resolve) => {
        releaseSearch = resolve;
      });
      await page.route("**/api/ror?**", async (route) => {
        await pending;
        await route.fulfill({ json: [] });
      });
      await search(page).fill("no matches");
      await expect(page.getByRole("status")).toHaveText("Searching workplaces");
      const scan = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      try {
        expect((await scan()).violations, "loading").toEqual([]);
      } finally {
        releaseSearch();
      }
      await expect(page.getByRole("status")).toContainText("No workplaces match");
      expect((await scan()).violations, "empty results").toEqual([]);

      await page.unroute("**/api/ror?**");
      await page.route("**/api/ror?**", (route) => route.fulfill({ status: 503, json: { error: "ROR unavailable" } }));
      await search(page).fill("stan");
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      expect((await scan()).violations, "search error").toEqual([]);
      await expect(search(page)).toHaveAttribute("aria-expanded", "false");
      await expect(search(page)).not.toHaveAttribute("aria-activedescendant");
    });
  }
});
