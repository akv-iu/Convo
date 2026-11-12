/** The Find tab: the person finder over everyone, on the fake API. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ME = "p_003";
const box = (page: Page) => page.getByRole("searchbox", { name: "Find people by country, workplace, organisation or skill" });

async function openFind(page: Page) {
  await page.setExtraHTTPHeaders({ "x-demo-user": ME });
  await page.goto("/find");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Find people");
}

test.describe("find people", () => {
  test("an example finds the people who show it, and the page passes axe", async ({ page }) => {
    await openFind(page);
    await page.getByRole("button", { name: "Kubernetes", exact: true }).click();
    await expect(box(page)).toHaveValue("Kubernetes");
    await expect(page.getByText(/^\d+ (person|people) for .Kubernetes./)).toBeVisible();
    const found = await (await page.request.get("/api/find?q=Kubernetes", { headers: { "x-demo-user": ME } })).json();
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((p: { id: string }) => p.id === ME)).toBe(false); // never yourself
    await expect(page.getByRole("main").getByText(found[0].name, { exact: true }).first()).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  });

  test("a search no one fits says so", async ({ page }) => {
    await openFind(page);
    await box(page).fill("Zzyzx Qwerty");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("No one shows “Zzyzx Qwerty” on their badge.")).toBeVisible();
  });

  test("a failed search says so, and Try again searches again", async ({ page }) => {
    let failing = true;
    await page.route("**/api/find?*", (route) => (failing ? route.fulfill({ status: 503, json: { error: "Unavailable" } }) : route.fallback()));
    await openFind(page);
    await box(page).fill("Kubernetes");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "The search didn't work just now." })).toBeVisible();
    failing = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText(/^\d+ (person|people) for .Kubernetes./)).toBeVisible();
  });
});
