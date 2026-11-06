import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * A1 step 3: the profile card. Runs on the fake API, whose profiles are
 * shared by every test in the server process, so each test acts as a
 * different fixture person (x-demo-user) and checks the request it sends.
 */

const AFTER_SUBMIT = 15_000;

const asPerson = (page: Page, id: string) => page.setExtraHTTPHeaders({ "x-demo-user": id });
const isSave = (req: Request) => req.url().endsWith("/api/me") && req.method() === "PUT";
const saveButton = (page: Page) => page.getByRole("button", { name: "Save and continue" });
const nameField = (page: Page) => page.getByRole("textbox", { name: "Name" });
const visibleBadge = (page: Page) =>
  page.locator("[data-badge-stripe]:visible").locator("xpath=ancestor::div[@aria-hidden='true'][1]");
/** The save error; Next.js also renders an empty role="alert" route announcer. */
const alertWithText = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

async function open(page: Page, person: string) {
  await asPerson(page, person);
  await page.goto("/onboarding/profile");
  await expect(nameField(page)).toBeVisible();
}

test.describe("profile card (A1 step 3)", () => {
  test("shows what was imported, on the card and the badge", async ({ page }) => {
    await open(page, "p_003");
    await expect(nameField(page)).toHaveValue("Aisha Bello");
    await expect(page.getByRole("textbox", { name: "Bio" })).toHaveValue(/OpenTelemetry collector contributor/);
    const skills = page.getByRole("list", { name: "Can help with" });
    await expect(skills.getByRole("listitem")).toHaveText(["Go", "Python"].map((s) => new RegExp(`^${s}`)));
    await expect(page.getByRole("list", { name: "Part of" }).getByRole("listitem")).toHaveCount(1);

    const badge = visibleBadge(page);
    await expect(badge).toContainText("Aisha Bello");
    await expect(badge).toContainText("@aishab");
    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toContainText("Step 3 of 4");
  });

  test("saves only what changed, then moves to step 4", async ({ page }, testInfo) => {
    // This test saves, and the fake keeps saved profiles for the whole run, so it works from
    // whatever the card shows now (phone and laptop runs and retries share one server).
    await open(page, "p_005");
    const chips = page.getByRole("list", { name: "Can help with" }).getByRole("listitem").locator("span").first();
    const before = (await page.getByRole("list", { name: "Can help with" }).getByRole("listitem").allTextContents()).map((t) =>
      t.replace(/×$/, "").trim(),
    );
    expect(before.length).toBeGreaterThan(0);
    const added = `GitOps ${testInfo.project.name} ${testInfo.retry}`;
    const removed = before[0];

    await page.getByRole("textbox", { name: "Add a skill" }).fill(added);
    await page.getByRole("textbox", { name: "Add a skill" }).press("Enter"); // adds, doesn't submit
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
    await page.getByRole("button", { name: `Remove ${removed} from your profile` }).click();
    await expect(visibleBadge(page)).toContainText(added);
    await expect(chips).not.toHaveText(removed);

    const saving = page.waitForRequest(isSave);
    await saveButton(page).click();
    expect((await saving).postDataJSON()).toEqual({ languages: [...before.slice(1), added] });
    await expect(page).toHaveURL(/\/onboarding\/free-time$/, { timeout: AFTER_SUBMIT });
    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toContainText("Step 4 of 4");
  });

  test("continuing with no changes sends nothing", async ({ page }) => {
    await open(page, "p_006");
    let saved = false;
    page.on("request", (req) => {
      if (isSave(req)) saved = true;
    });
    await saveButton(page).click();
    await expect(page).toHaveURL(/\/onboarding\/free-time$/, { timeout: AFTER_SUBMIT });
    expect(saved).toBe(false);
  });

  test("an empty name is explained and nothing is sent", async ({ page }) => {
    await open(page, "p_004");
    let saved = false;
    page.on("request", (req) => {
      if (isSave(req)) saved = true;
    });
    await nameField(page).fill("   ");
    await saveButton(page).click();
    await expect(page.getByText("Add the name people should see.")).toBeVisible();
    await expect(nameField(page)).toBeFocused();
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
    expect(saved).toBe(false);
  });

  test("a duplicate skill is refused with a reason", async ({ page }) => {
    await open(page, "p_002");
    await page.getByRole("textbox", { name: "Add a skill" }).fill("go");
    await page.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(page.getByText("That's already on your badge.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Can help with" }).getByRole("listitem")).toHaveCount(1);
  });

  test("tapping a part of the badge jumps to its field", async ({ page, isMobile }) => {
    test.skip(isMobile, "checked on the laptop layout, where the badge sits beside the fields");
    await open(page, "p_001");
    await visibleBadge(page).getByText("Can help with", { exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Add a skill" })).toBeFocused();
    await visibleBadge(page).getByText("Priya Natarajan", { exact: true }).click();
    await expect(nameField(page)).toBeFocused();
  });

  test("the badge colour can be changed here and is saved", async ({ page }) => {
    await open(page, "u_demo_b");
    await page.getByRole("radio", { name: "Sky" }).check({ force: true });
    await expect
      .poll(() =>
        page
          .locator("[data-badge-stripe]")
          .evaluateAll((els) => els.filter((el) => el.checkVisibility()).map((el) => getComputedStyle(el).backgroundColor)[0]),
      )
      .toBe("rgb(125, 211, 252)");
    await saveButton(page).click();
    await expect(page).toHaveURL(/\/onboarding\/free-time$/, { timeout: AFTER_SUBMIT });
    const raw = (await page.context().cookies()).find((c) => c.name === "convo_badge")?.value ?? "";
    expect(JSON.parse(decodeURIComponent(raw))).toMatchObject({ colour: "sky" });
  });

  test("unfinished onboarding sends you back to About you", async ({ page }) => {
    await page.route("**/api/me", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 409, json: { error: "Complete onboarding first." } })
        : route.fallback(),
    );
    await page.goto("/onboarding/profile");
    await expect(alertWithText(page)).toHaveText("Answer the three quick questions first.");
    await expect(page.getByRole("link", { name: "Go to About you" })).toHaveAttribute("href", "/onboarding");
  });

  test("a failed load can be retried", async ({ page }) => {
    let calls = 0;
    await asPerson(page, "p_003");
    await page.route("**/api/me", (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      calls++;
      return calls === 1 ? route.fulfill({ status: 503, json: { error: "Storage unavailable" } }) : route.fallback();
    });
    await page.goto("/onboarding/profile");
    await expect(alertWithText(page)).toHaveText("Your profile didn't load. Try again in a moment.");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(nameField(page)).toHaveValue("Aisha Bello");
  });

  test("a failed save keeps the edits and shows the server's message", async ({ page }) => {
    await open(page, "p_003");
    await page.route("**/api/me", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 503, json: { error: "Profile saved, but search update failed. Retry the same save." } })
        : route.fallback(),
    );
    await page.getByRole("textbox", { name: "Bio" }).fill("New bio for the badge");
    await saveButton(page).click();
    await expect(alertWithText(page)).toHaveText("Profile saved, but search update failed. Retry the same save.");
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
    await expect(page.getByRole("textbox", { name: "Bio" })).toHaveValue("New bio for the badge");
    await expect(saveButton(page)).toBeEnabled();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, "p_002");
      const scan = async (label: string) =>
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, label).toEqual([]);
      await scan("loaded");
      await nameField(page).fill("");
      await page.getByRole("textbox", { name: "Add a skill" }).fill("go");
      await page.getByRole("textbox", { name: "Add a skill" }).press("Enter");
      await saveButton(page).click();
      await expect(page.getByText("Add the name people should see.")).toBeVisible();
      await scan("with errors");
      await page.goto("/onboarding/free-time");
      await scan("step 4 placeholder");
    });
  }
});
