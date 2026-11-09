/**
 * With PROFILE_ENRICHMENT_ENABLED off (this suite's server), the enrichment
 * pages stay hidden and step 1 keeps the GitHub sign-in it has today.
 * tests/e2e/enrichment/ covers the switched-on flow.
 */
import { expect, test } from "@playwright/test";

test("with profile enrichment off, page two shows not found and step 1 is unchanged", async ({ page }) => {
  await page.goto("/signin/sources");
  // The layout streams first, so Next serves its not-found page (noindex) with status 200.
  await expect(page.getByText("This page could not be found")).toBeVisible();
  await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
  await expect(page.getByRole("heading", { name: "Choose what Lanyard reads" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Continue with (Google|GitHub)/ })).toHaveCount(0);

  await page.goto("/signin");
  await expect(page.getByText("Where should we look?")).toBeVisible();
  await expect(page.getByText("Where should Lanyard look?")).toHaveCount(0);
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
});
