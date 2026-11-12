/**
 * Contact details on page five of profile enrichment (PROFILE_ENRICHMENT_ENABLED=1), for a fresh
 * Google-only fixture (u_google_new_<suffix>), not a demo user. The import is started through the
 * fake API, as pages one and two would, so these tests start on page five.
 */
import { expect, test, type Page } from "@playwright/test";

const READY = 20_000; // the fake advances a job each time it's read; page five polls every two seconds

async function send(page: Page, user: string, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const response = await page.request.fetch(path, { method, headers: { "x-demo-user": user }, ...(data === undefined ? {} : { data }) });
  expect(response.ok(), `${method} ${path}`).toBe(true);
  return response.json();
}

/** Badge saved (as page three does), then an import with a research author and pasted text. */
async function startImport(page: Page) {
  const user = `u_google_new_${test.info().project.name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await page.setExtraHTTPHeaders({ "x-demo-user": user });
  await send(page, user, "PUT", "/api/me", { name: "Ada Lovelace", filters: { country: "GB", rorId: null, hiring: true }, workplaceName: "Analytical Engines" });
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

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const email = (page: Page) => page.getByRole("textbox", { name: "Email" });

async function approve(page: Page) {
  await page.goto("/onboarding/profile");
  await expect(heading(page)).toHaveText("Check your bio", { timeout: READY });
  await page.getByRole("button", { name: "Approve and continue" }).click();
  await expect(heading(page)).toHaveText("Are these the correct details?");
}

test.describe("profile enrichment: contact details", () => {
  test("after approving the bio, the details page has contact details, and a saved email stays", async ({ page }) => {
    const user = await startImport(page);
    expect(await send(page, user, "GET", "/api/me/contact")).toMatchObject({ email: null }); // works straight after the badge
    await approve(page);
    await expect(page.getByRole("heading", { name: "Contact details" })).toBeVisible();
    await email(page).fill("ada@example.com");
    await page.getByRole("button", { name: "Yes, that's me" }).click();
    await expect(page).toHaveURL(/\/ask$/);
    expect(await send(page, user, "GET", "/api/me/contact")).toMatchObject({ email: "ada@example.com" });

    await page.goto("/onboarding/profile");
    await page.reload();
    await expect(email(page)).toHaveValue("ada@example.com", { timeout: READY });
  });

  test("a contact details load that fails once shows the error and Try again, not an empty form", async ({ page }) => {
    await startImport(page);
    let fails = 1;
    await page.route("**/api/me/contact", (route) =>
      route.request().method() === "GET" && fails-- > 0 ? route.fulfill({ status: 503, json: { error: "Unavailable" } }) : route.fallback(),
    );
    await approve(page);
    await expect(page.getByRole("alert").filter({ hasText: "Your saved contact details didn't load" })).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "didn't load" })).toHaveCount(0);
    await expect(email(page)).toHaveValue("");
  });
});
