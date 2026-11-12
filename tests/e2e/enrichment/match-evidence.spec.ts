/**
 * Approved profile enrichment evidence on the redesigned match cards (PROFILE_ENRICHMENT_ENABLED=1).
 * A fresh Google-only fixture (u_google_new_<suffix>) approves a draft with a paper and a profile
 * page, leaving the CV excerpt unticked; another person's ask then finds them.
 */
import { expect, test, type Page } from "@playwright/test";

const READY = 20_000; // the fake advances a job each time it's read; page five polls every two seconds
const SEARCHER = "p_003";

async function send(page: Page, user: string, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const response = await page.request.fetch(path, {
    method, headers: { "x-demo-user": user }, ...(data instanceof FormData ? { multipart: data } : data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${method} ${path}`).toBe(true);
  return response.json();
}

test("a match card shows the paper and profile page someone approved, and not the CV excerpt they left out", async ({ page }) => {
  const token = `zq${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; // only this person's bio has it
  const user = `u_google_new_${test.info().project.name}_${token}`;
  const name = "Ada Lovelace";
  await page.setExtraHTTPHeaders({ "x-demo-user": user });
  await send(page, user, "PUT", "/api/me", { name, filters: { country: "GB", rorId: null, hiring: true }, workplaceName: "Analytical Engines" });
  const identity = { name, country: "GB", workplaceName: "Analytical Engines", rorId: null, orcid: null };
  await send(page, user, "PUT", "/api/profile-enrichment", identity);
  const where = { name, workplaceName: identity.workplaceName, rorId: null, orcid: null };
  const research = await send(page, user, "POST", "/api/profile-enrichment/discover", { source: "research", ...where });
  const pages = await send(page, user, "POST", "/api/profile-enrichment/discover", { source: "public_profile", ...where });
  const form = new FormData();
  form.set("consent", "true");
  form.set("text", "Postdoctoral researcher in quantum hardware.");
  const cv = await send(page, user, "POST", "/api/profile-enrichment/cv", form);
  await send(page, user, "POST", "/api/profile-enrichment", {
    identity, idempotencyKey: crypto.randomUUID(),
    github: { import: false, bio: false, repos: false, orgs: false },
    research: { discoveryId: research.discoveryId, candidateId: research.candidates[0].id },
    publicProfile: { discoveryId: pages.discoveryId, candidateId: pages.candidates[0].id },
    cv: { uploadId: cv.uploadId },
  });

  // Page five: approve with the CV excerpt left unticked (as it starts).
  await page.goto("/onboarding/profile");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your bio", { timeout: READY });
  await expect(page.getByRole("checkbox", { name: /^CV excerpt/ })).not.toBeChecked();
  await page.getByRole("textbox", { name: "Bio" }).fill(`I build reliable systems. ${token}`);
  await page.getByRole("button", { name: "Approve and continue" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your bio is approved." })).toBeVisible();

  // Someone else asks; this person is found, and their card shows the approved evidence.
  const { askId } = await send(page, SEARCHER, "POST", "/api/refine", { text: `reliable systems ${token}` });
  await page.setExtraHTTPHeaders({ "x-demo-user": SEARCHER });
  await page.goto(`/matches?ask=${askId}`);
  const matches = page.getByRole("region", { name: "Matches" });
  const row = matches.locator("button[aria-expanded]").filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: READY });
  await row.click();
  const card = matches.getByRole("region").filter({ hasText: name }).first();
  await expect(card.getByText("Paper", { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: /Recorded research example/ })).toHaveAttribute("href", "https://openalex.org/W5000000100");
  await expect(card.getByText("Profile page", { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: new RegExp(pages.candidates[0].title) })).toHaveAttribute("href", pages.candidates[0].url);
  await expect(card.getByText("CV", { exact: true })).toHaveCount(0);
  await expect(card).not.toContainText("CV excerpt");
});
