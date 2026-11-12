/**
 * Round 5's badge controls inside the profile enrichment flow (PROFILE_ENRICHMENT_ENABLED=1):
 * page three (the badge) and page five (your details, after the bio is approved). A fresh
 * Google-only fixture (u_google_new_<suffix>) with no GitHub; the import is started through
 * the fake API, as pages one and two would, so the test starts on page three.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const READY = 20_000; // the fake advances a job each time it's read; page five polls every two seconds

async function send(page: Page, user: string, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const response = await page.request.fetch(path, { method, headers: { "x-demo-user": user }, ...(data === undefined ? {} : { data }) });
  expect(response.ok(), `${method} ${path}`).toBe(true);
  return response.json();
}

/** Pages one and two through the API: identity, a research author and pasted text, GitHub off. */
async function startImport(page: Page) {
  const user = `u_google_new_${test.info().project.name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await page.setExtraHTTPHeaders({ "x-demo-user": user });
  const identity = { name: "Ada Lovelace", country: "GB", workplaceName: "Analytical Engines", rorId: null, orcid: null };
  await send(page, user, "PUT", "/api/profile-enrichment", identity);
  const found = await send(page, user, "POST", "/api/profile-enrichment/discover", { source: "research", name: identity.name, workplaceName: identity.workplaceName, rorId: null, orcid: null });
  await send(page, user, "POST", "/api/profile-enrichment", {
    identity, idempotencyKey: crypto.randomUUID(),
    github: { import: false, bio: false, repos: false, orgs: false },
    research: { discoveryId: found.discoveryId, candidateId: found.candidates[0].id },
    publicProfile: { kind: "text", text: "Ada builds reliable systems." },
    cv: null,
  });
  return user;
}

async function scan(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== "running"));
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, `${label} (${colorScheme})`).toEqual([]);
  }
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
// Next keeps earlier pages in the DOM, hidden, so only the visible badge counts.
const badge = (page: Page) => page.locator("[data-badge]:visible");
const continueButton = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
const workplaceSwitch = (page: Page) => page.getByRole("switch", { name: "Workplace", exact: true });

test("round 5's badge controls work on pages three and five, and survive going back", async ({ page }) => {
  const user = await startImport(page);

  // Page three: the saved identity, no GitHub, an eraser after each line that can be hidden.
  await page.goto("/onboarding");
  await expect(heading(page)).toHaveText("Your badge");
  await expect(page.getByText("Step 3 of 5")).toBeVisible();
  await expect(badge(page)).toContainText("Ada Lovelace");
  await expect(badge(page)).not.toContainText("@");
  await expect(badge(page).locator("[data-eraser]")).toHaveCount(3); // country, workplace, hiring
  await page.locator("label").filter({ hasText: "Not right now" }).click();

  // Tapping the workplace on the badge hides it, and the switch beside it follows.
  await badge(page).getByText("Analytical Engines", { exact: true }).click();
  await expect(badge(page)).not.toContainText("Analytical Engines");
  await expect(workplaceSwitch(page)).not.toBeChecked();
  await scan(page, "badge");
  await continueButton(page).click();
  await expect(page).toHaveURL(/\/onboarding\/free-time$/);
  expect(await send(page, user, "GET", "/api/me")).toMatchObject({ visibility: { workplace: false }, filters: { hiring: false } });

  // Back from free time: the badge keeps every choice.
  await page.getByRole("link", { name: "Back to Your badge" }).click();
  await expect(heading(page)).toHaveText("Your badge");
  await expect(workplaceSwitch(page)).not.toBeChecked();
  await expect(page.getByRole("radio", { name: /Not right now/ })).toBeChecked();
  await expect(badge(page)).not.toContainText("Analytical Engines");
  await continueButton(page).click();
  await expect(page).toHaveURL(/\/onboarding\/free-time$/);
  await page.getByRole("button", { name: /^Morning/ }).click();
  await continueButton(page).click();

  // Page five: approve the draft, then the details page shows the approved bio on the same badge.
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
  await expect(heading(page)).toHaveText("Check your bio", { timeout: READY });
  const bio = (await page.getByRole("textbox", { name: "Bio" }).inputValue()).trim();
  await page.getByRole("button", { name: "Approve and continue" }).click();
  await expect(heading(page)).toHaveText("Are these the correct details?");
  await expect(badge(page)).toContainText(bio);
  await expect(badge(page)).not.toContainText("Analytical Engines"); // hidden stays hidden
  await expect(badge(page).locator("[data-eraser]")).toHaveCount(2); // country and hiring
  await scan(page, "details");
  await page.getByRole("button", { name: "Yes, that's me" }).click();
  await expect(page).toHaveURL(/\/ask$/);
});
