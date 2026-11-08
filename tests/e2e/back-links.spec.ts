import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Every screen has a "← Back to …" link to the screen before it in the flow
 * (not the browser history), so a reload or shared link still goes somewhere
 * sensible. Read-only: nothing here saves.
 */

const ME = "p_003";

const screens = [
  { path: "/signin", label: "Back to home", target: "/" },
  { path: "/onboarding", label: "Back to About you", target: "/signin" },
  { path: "/onboarding/free-time", label: "Back to Your badge", target: "/onboarding" },
  { path: "/onboarding/profile", label: "Back to Free time", target: "/onboarding/free-time" },
  { path: "/ask", label: "Back to Your details", target: "/onboarding/profile" },
  { path: "/matches?ask=made-up", label: "Back to Ask", target: "/ask" },
  { path: "/inbox", label: "Back to Ask", target: "/ask" },
] as const;

test.describe("back links", () => {
  for (const s of screens) {
    test(`${s.path} links back to ${s.target}`, async ({ page }) => {
      await page.setExtraHTTPHeaders({ "x-demo-user": ME });
      await page.goto(s.path);
      const back = page.getByRole("link", { name: s.label, exact: true });
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute("href", s.target);
    });
  }

  test("Back on step 3 opens step 2, and it works from the keyboard", async ({ page, isMobile }) => {
    await page.setExtraHTTPHeaders({ "x-demo-user": ME });
    await page.goto("/onboarding/free-time");
    const back = page.getByRole("link", { name: "Back to Your badge" });
    if (isMobile) await back.click();
    else {
      await back.focus();
      await page.keyboard.press("Enter");
    }
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your badge");
  });

  test("the back link passes axe on step 2", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-demo-user": ME });
    await page.goto("/onboarding");
    await expect(page.getByRole("link", { name: "Back to About you" })).toBeVisible();
    const results = await new AxeBuilder({ page }).include("a[href='/signin']").analyze();
    expect(results.violations).toEqual([]);
  });
});
