import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page loads and has no accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lanyard");
  // Developer notes stay on /dev/routes, not the front door.
  await expect(page.getByText("FAKE_API")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "API contract" })).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("the fake API answers through the real route handlers", async ({ request }) => {
  const me = await request.get("/api/me");
  expect(me.ok()).toBe(true);
  expect((await me.json()).id).toBe("u_demo_a");

  const other = await request.get("/api/me", { headers: { "x-demo-user": "u_demo_b" } });
  expect((await other.json()).id).toBe("u_demo_b");

  const refined = await request.post("/api/refine", { data: { text: "How does scheduler preemption pick victims?" } });
  expect(refined.ok()).toBe(true);
  const { askId } = await refined.json();
  const match = await request.post("/api/match", { data: { askId } });
  expect((await match.json())[0].person.id).toBe("u_demo_b");
});
