import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * Step 4, "Are these the correct details?". Runs on the fake API, whose
 * profiles are shared by every test in the server process, so each test
 * acts as a different fixture person (x-demo-user) and checks what the
 * server stored, not only the request sent.
 */

const AFTER_SUBMIT = 15_000;

const asPerson = (page: Page, id: string) => page.setExtraHTTPHeaders({ "x-demo-user": id });
const isSave = (req: Request) => req.url().endsWith("/api/me") && req.method() === "PUT";
const yes = (page: Page) => page.getByRole("button", { name: "Yes, that's me" });
const no = (page: Page) => page.getByRole("button", { name: "No, let me fix it" });
const saveButton = (page: Page) => page.getByRole("button", { name: "Save and finish" });
const nameField = (page: Page) => page.getByRole("textbox", { name: "Name" });
const visibleBadge = (page: Page) =>
  page.locator("[data-badge-stripe]:visible").locator("xpath=ancestor::div[@aria-hidden='true'][1]");
/** Next.js also renders an empty role="alert" route announcer. */
const alertWithText = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

async function open(page: Page, person: string) {
  await asPerson(page, person);
  await page.goto("/onboarding/profile");
  await expect(yes(page)).toBeVisible();
}

async function openEditor(page: Page, person: string) {
  await open(page, person);
  await no(page).click();
  await expect(nameField(page)).toBeFocused();
}

async function stored(page: Page, person: string) {
  const res = await page.request.get("/api/me", { headers: { "x-demo-user": person } });
  expect(res.ok()).toBe(true);
  return res.json();
}

test.describe("your details (step 4)", () => {
  test("asks whether what was found is right, shown as the badge", async ({ page }) => {
    await open(page, "p_003");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Are these the correct details?");
    const badge = visibleBadge(page);
    await expect(badge).toContainText("Aisha Bello");
    await expect(badge).toContainText("@aishab");
    await expect(badge).toContainText("United Kingdom");
    await expect(badge).toContainText("Go");
    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toContainText("Step 4 of 4");
  });

  test("shows your row as other people see it, and hiding a section saves and updates it", async ({ page, isMobile }) => {
    const person = isMobile ? "p_006" : "p_004"; // one per project, so runs can't overlap
    const all = { country: true, workplace: true, hiring: true };
    await page.request.put("/api/me", { headers: { "x-demo-user": person }, data: { visibility: all } });
    await open(page, person);
    const preview = page.getByTestId("seen-preview");
    const me = await stored(page, person);
    await expect(preview).toContainText(me.name);
    const row = page.getByRole("group", { name: "Show in your row" });
    const country = row.getByRole("switch", { name: "Country" });
    await expect(country).toBeChecked();
    const shown = await preview.textContent();
    const saving = page.waitForRequest((r) => r.url().endsWith("/api/me") && r.method() === "PUT");
    await row.locator("label").filter({ has: page.getByRole("switch", { name: "Country" }) }).click(); // the visible row, hit-tested like a tap
    expect((await saving).postDataJSON()).toEqual({ visibility: { ...all, country: false } });
    await expect(country).not.toBeChecked();
    await expect.poll(() => preview.textContent()).not.toBe(shown);
    expect((await stored(page, person)).visibility).toEqual({ ...all, country: false });
    await page.request.put("/api/me", { headers: { "x-demo-user": person }, data: { visibility: all } });
  });

  test("Yes finishes without saving anything", async ({ page }) => {
    await open(page, "p_006");
    let saved = false;
    page.on("request", (req) => {
      if (isSave(req)) saved = true;
    });
    await yes(page).click();
    await expect(page).toHaveURL(/\/ask$/, { timeout: AFTER_SUBMIT });
    expect(saved).toBe(false);
  });

  test("No opens the editor, with uploads marked coming soon", async ({ page }) => {
    await openEditor(page, "p_002");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fix your details");
    await expect(page.getByRole("button", { name: /Upload a CV or LinkedIn export/ })).toBeDisabled();
    await expect(page.getByText("Coming soon")).toBeVisible();
  });

  test("tapping a part of the badge opens the editor at that field", async ({ page, isMobile }) => {
    test.skip(isMobile, "checked on the laptop layout, where the badge sits beside the text");
    await open(page, "p_001");
    await visibleBadge(page).getByText("Can help with", { exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Add a skill" })).toBeFocused();
  });

  test("fixing details saves only what changed, and the server keeps it", async ({ page }, testInfo) => {
    // The fake keeps saved profiles for the whole run (phone, laptop, retries), so work from what's shown.
    await openEditor(page, "p_005");
    const before = (await page.getByRole("list", { name: "Can help with" }).getByRole("listitem").allTextContents()).map((t) =>
      t.replace(/×$/, "").trim(),
    );
    expect(before.length).toBeGreaterThan(0);
    const added = `GitOps ${testInfo.project.name} ${testInfo.retry}`;

    await page.getByRole("textbox", { name: "Add a skill" }).fill(added);
    await page.getByRole("textbox", { name: "Add a skill" }).press("Enter"); // adds, doesn't submit
    await page.getByRole("button", { name: `Remove ${before[0]} from your profile` }).click();
    await expect(visibleBadge(page)).toContainText(added);

    const expected = [...before.slice(1), added];
    const saving = page.waitForRequest(isSave);
    await saveButton(page).click();
    expect((await saving).postDataJSON()).toEqual({ languages: expected });
    await expect(page).toHaveURL(/\/ask$/, { timeout: AFTER_SUBMIT });
    expect((await stored(page, "p_005")).languages).toEqual(expected);
  });

  test("fields keep their own names for screen readers, not the badge's text", async ({ page }) => {
    await openEditor(page, "p_002");
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Bio", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Add a skill", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Add an organisation", exact: true })).toBeVisible();
  });

  test("tapping the badge in the editor moves to that field", async ({ page, isMobile }) => {
    test.skip(isMobile, "checked on the laptop layout, where the badge sits beside the form");
    await openEditor(page, "p_002");
    await visibleBadge(page).getByText("Bio", { exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Bio", exact: true })).toBeFocused();
  });

  test("text left in an Add box is saved with Save and finish", async ({ page, isMobile }, testInfo) => {
    const person = isMobile ? "p_002" : "p_001"; // one per project, so runs can't overlap
    const before = (await stored(page, person)).organisations as string[];
    await openEditor(page, person);
    const typed = `kept-${testInfo.project.name}-${testInfo.retry}`;
    await page.getByRole("textbox", { name: "Add an organisation" }).fill(typed);
    const saving = page.waitForRequest(isSave);
    await saveButton(page).click();
    expect((await saving).postDataJSON()).toEqual({ organisations: [...before, typed] });
    await expect(page).toHaveURL(/\/ask$/, { timeout: AFTER_SUBMIT });
    expect((await stored(page, person)).organisations).toContain(typed);
    // Put it back so other runs start the same.
    await page.request.put("/api/me", { headers: { "x-demo-user": person }, data: { organisations: before } });
  });

  test("text in an Add box that can't be added stops the save with the reason", async ({ page }) => {
    await openEditor(page, "p_004");
    let saved = false;
    page.on("request", (req) => {
      if (isSave(req)) saved = true;
    });
    await page.getByRole("textbox", { name: "Add a skill" }).fill("x".repeat(45));
    await saveButton(page).click();
    await expect(page.getByText("Keep it under 40 characters.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Add a skill" })).toBeFocused();
    expect(saved).toBe(false);
  });

  test("after a failed save, Save and finish saves again even with the edits undone", async ({ page }) => {
    await openEditor(page, "p_006");
    let fail = true;
    const sent: unknown[] = [];
    await page.route("**/api/me", (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      sent.push(route.request().postDataJSON());
      if (fail) return route.fulfill({ status: 503, json: { error: "Profile saved, but search update failed. Retry the same save." } });
      return route.fallback();
    });
    const bio = page.getByRole("textbox", { name: "Bio" });
    const original = await bio.inputValue();
    await bio.fill(`${original} (edited)`);
    await saveButton(page).click();
    await expect(alertWithText(page)).toContainText("Retry the same save");
    await bio.fill(original);
    fail = false;
    await saveButton(page).click();
    await expect(page).toHaveURL(/\/ask$/, { timeout: AFTER_SUBMIT });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({}); // the documented repair: an empty save
  });

  test("a save that finds the profile gone offers sign-in", async ({ page }) => {
    await openEditor(page, "p_003");
    await page.route("**/api/me", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 404, json: { error: "Profile not found. Sign in again." } })
        : route.fallback(),
    );
    await page.getByRole("textbox", { name: "Bio" }).fill("Changed");
    await saveButton(page).click();
    await expect(alertWithText(page)).toContainText("Your sign-in has expired");
    await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/signin");
  });

  test("an empty name is explained and nothing is sent", async ({ page }) => {
    await openEditor(page, "p_004");
    let saved = false;
    page.on("request", (req) => {
      if (isSave(req)) saved = true;
    });
    await nameField(page).fill("   ");
    await saveButton(page).click();
    await expect(page.getByText("Add the name people should see.")).toBeVisible();
    await expect(nameField(page)).toBeFocused();
    expect(saved).toBe(false);
  });

  test("a duplicate skill is refused with a reason", async ({ page }) => {
    await openEditor(page, "p_002");
    await page.getByRole("textbox", { name: "Add a skill" }).fill("go");
    await page.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(page.getByText("That's already on your badge.")).toBeVisible();
  });

  test("unfinished onboarding sends you back to step 1", async ({ page }) => {
    await page.route("**/api/me", (route) =>
      route.request().method() === "GET" ? route.fulfill({ status: 409, json: { error: "Complete onboarding first." } }) : route.fallback(),
    );
    await page.goto("/onboarding/profile");
    await expect(alertWithText(page)).toHaveText("Start with your name, workplace and country.");
    await expect(page.getByRole("link", { name: "Go to About you" })).toHaveAttribute("href", "/signin");
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
    await expect(visibleBadge(page)).toContainText("Aisha Bello");
  });

  test("a failed save keeps the edits and shows the server's message", async ({ page }) => {
    await openEditor(page, "p_003");
    await page.route("**/api/me", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 503, json: { error: "Profile saved, but search update failed. Retry the same save." } })
        : route.fallback(),
    );
    await page.getByRole("textbox", { name: "Bio" }).fill("New bio for the badge");
    await saveButton(page).click();
    await expect(alertWithText(page)).toHaveText("Profile saved, but search update failed. Retry the same save.");
    await expect(page.getByRole("textbox", { name: "Bio" })).toHaveValue("New bio for the badge");
    await expect(saveButton(page)).toBeEnabled();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const scan = async (label: string) =>
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, label).toEqual([]);
      await open(page, "p_002");
      await scan("review");
      await no(page).click();
      await nameField(page).fill("");
      await saveButton(page).click();
      await expect(page.getByText("Add the name people should see.")).toBeVisible();
      await scan("editor with errors");
      await page.goto("/ask");
      await scan("ask screen");
    });
  }
});
