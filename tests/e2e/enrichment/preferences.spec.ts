/**
 * Profile enrichment pages three (badge) and four (free time), with
 * PROFILE_ENRICHMENT_ENABLED=1 on the fake API. Each test signs in as its own
 * fresh Google-only fixture (u_google_new_<suffix>). The fake import moves on
 * one step each time the job is read, so page four's own polling finishes it.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function asNewGoogleUser(page: Page): Promise<string> {
  const user = `u_google_new_${test.info().project.name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await page.setExtraHTTPHeaders({ "x-demo-user": user });
  return user;
}

async function owner(page: Page, user: string) {
  const response = await page.request.get("/api/profile-enrichment", { headers: { "x-demo-user": user } });
  expect(response.ok()).toBe(true);
  return response.json();
}

/** A switch's whole row is its label; tap that, as a person would. */
async function toggle(page: Page, name: string) {
  await page.locator("label").filter({ has: page.getByRole("switch", { name, exact: true }) }).click();
}

/** Text on the current page only: earlier pages Next keeps hidden in the DOM don't count. */
const shown = (page: Page, text: string | RegExp, options?: { exact?: boolean }) => page.getByText(text, options).filter({ visible: true });
const progress = (page: Page) => page.getByRole("navigation", { name: "Onboarding progress" });
// Next keeps earlier pages in the DOM, hidden, so only the visible badge counts.
const badge = (page: Page) => page.locator("[data-badge]:visible");
const continueButton = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });

/** Page one, then page two with GitHub off and a research author chosen, then Continue: the import starts. */
async function startImport(page: Page, name = "Ada Lovelace") {
  await page.goto("/signin");
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("textbox", { name: "Workplace" }).fill("Analytical Engines");
  await page.getByLabel("Country").selectOption("GB");
  await toggle(page, "GitHub");
  await continueButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose what Lanyard reads");
  await page.getByRole("region", { name: "Research papers", exact: true }).getByRole("radio", { name: /Ada Lovelace \(demo 2\)/ }).check();
  await continueButton(page).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function scan(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== "running"));
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, `${label} (${colorScheme})`).toEqual([]);
  }
}

test.describe("profile enrichment: badge and free time", () => {
  test("a Google-only person makes their badge and picks free times while the import runs, and keeps them going back", async ({ page }) => {
    const user = await asNewGoogleUser(page);
    await startImport(page);
    const job = (await owner(page, user)).job;
    expect(job).not.toBeNull();

    // Page three: the account's saved identity, no GitHub handle, and the five-page flow.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your badge");
    await expect(progress(page)).toContainText("Step 3 of 5");
    await expect(page.getByRole("link", { name: "Back to Sign in and sources" })).toHaveAttribute("href", "/signin/sources");
    await expect(badge(page)).toContainText("Ada Lovelace");
    await expect(badge(page)).toContainText("Analytical Engines");
    await expect(badge(page)).not.toContainText("@"); // no "@your-github" placeholder and no handle line
    await expect(shown(page, "Your name is always shown.", { exact: false })).toBeVisible();

    await page.locator("label").filter({ hasText: "Not right now" }).click();
    await page.getByRole("button", { name: "Choose a picture" }).click();
    const picker = page.getByRole("group", { name: "Your picture" });
    await picker.locator("label").filter({ has: page.getByRole("radio", { name: "Moon" }) }).click();
    await page.getByRole("group", { name: "Badge colour" }).locator("label").filter({ has: page.getByRole("radio", { name: "Mint" }) }).click();
    await toggle(page, "Workplace");
    await scan(page, "badge");
    await continueButton(page).click();

    // Page four: the import's progress above the grid, finishing on its own; Continue is never blocked.
    await expect(page).toHaveURL(/\/onboarding\/free-time$/);
    await expect(progress(page)).toContainText("Step 4 of 5");
    await expect(page.getByRole("status").filter({ hasText: /Lanyard is reading your sources|Your sources have been read/ })).toBeVisible();
    await expect(shown(page, "Your sources have been read. You'll check your bio next.")).toBeVisible({ timeout: 15_000 });
    await scan(page, "free time");
    await page.getByRole("button", { name: /^Morning/ }).click();
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/onboarding\/profile$/);

    // Back to the badge, and a refresh: every choice was saved.
    await page.goto("/onboarding/free-time");
    await expect(page.getByRole("button", { name: /^Morning/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("link", { name: "Back to Your badge" }).click();
    for (const pass of ["back", "refresh"]) {
      if (pass === "refresh") await page.reload();
      await expect(page.getByRole("radio", { name: /Not right now/ }), pass).toBeChecked();
      await expect(page.getByRole("switch", { name: "Workplace", exact: true }), pass).not.toBeChecked();
      await expect(badge(page).locator("[data-avatar]"), pass).toHaveAttribute("data-avatar", "moon");
      await expect(page.getByRole("group", { name: "Badge colour" }).getByRole("radio", { name: "Mint" }), pass).toBeChecked();
    }

    // Back to page two: the choices are still there, and Continue without changes keeps the same import.
    await page.getByRole("link", { name: "Back to Sign in and sources" }).click();
    await expect(shown(page, "Your sources are already being read")).toBeVisible();
    await expect(page.getByRole("switch", { name: "GitHub", exact: true })).not.toBeChecked();
    const starts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/api/profile-enrichment") starts.push(r.url());
    });
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    expect(starts).toEqual([]);
    expect((await owner(page, user)).job.jobId).toBe(job.jobId);

    // A real change on page two does start again, replacing the old import.
    await page.getByRole("link", { name: "Back to Sign in and sources" }).click();
    await expect(shown(page, "Your sources are already being read")).toBeVisible();
    await toggle(page, "Research papers");
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    expect(starts).toHaveLength(1);
    expect((await owner(page, user)).job.jobId).not.toBe(job.jobId);
  });

  test("a connected GitHub shows its handle on the badge", async ({ page }) => {
    await asNewGoogleUser(page);
    await page.goto("/signin");
    await page.getByLabel("Your name").fill("Ada Lovelace");
    await page.getByRole("textbox", { name: "Workplace" }).fill("Analytical Engines");
    await page.getByLabel("Country").selectOption("GB");
    await continueButton(page).click();
    await page.getByRole("button", { name: "Connect GitHub" }).click();
    await expect(shown(page, "Connected as @demo-connected.", { exact: false })).toBeVisible();
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(badge(page)).toContainText("@demo-connected");
    await expect(shown(page, "Your name and GitHub are always shown.", { exact: false })).toBeVisible();
  });

  test("a stalled import says so and can be started again from page four", async ({ page }) => {
    await asNewGoogleUser(page);
    await startImport(page);
    await page.locator("label").filter({ hasText: "Not right now" }).click();

    // The recorded job, reported as stalled until Try again.
    let stalled = true;
    await page.route(/\/api\/profile-enrichment\/[^/]+$/, async (route) => {
      const response = await route.fetch();
      const job = await response.json();
      await route.fulfill({ response, json: stalled ? { ...job, state: "stalled" } : job });
    });
    const retries: string[] = [];
    await page.route(/\/api\/profile-enrichment\/[^/]+\/retry$/, async (route) => {
      retries.push(route.request().url());
      stalled = false;
      await route.continue();
    });
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/onboarding\/free-time$/);
    await expect(shown(page, "Reading your sources has stalled.")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    expect(retries).toHaveLength(1);
    await expect(shown(page, "Reading your sources has stalled.")).toHaveCount(0);
    await expect(shown(page, "Your sources have been read. You'll check your bio next.")).toBeVisible({ timeout: 15_000 });
    await expect(continueButton(page)).toBeEnabled(); // the import never blocks free time
  });

  test("a badge whose saved profile fails to load asks to try again instead of saving defaults over it", async ({ page }) => {
    const user = await asNewGoogleUser(page);
    await startImport(page);
    await page.locator("label").filter({ hasText: "Not right now" }).click();
    await page.getByRole("button", { name: "Choose a picture" }).click();
    await page.getByRole("group", { name: "Your picture" }).locator("label").filter({ has: page.getByRole("radio", { name: "Moon" }) }).click();
    await toggle(page, "Workplace");
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/onboarding\/free-time$/);

    let failing = true;
    await page.route("**/api/me", (route) =>
      failing && route.request().method() === "GET" ? route.fulfill({ status: 503, json: { error: "Recorded outage" } }) : route.continue(),
    );
    const saves: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PUT" && new URL(r.url()).pathname === "/api/me") saves.push(r.url());
    });
    await page.goto("/onboarding");
    await expect(page.getByRole("alert").filter({ hasText: "Your details didn't load" })).toBeVisible();
    await expect(continueButton(page)).toHaveCount(0); // nothing to save until the profile is back
    failing = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("switch", { name: "Workplace", exact: true })).not.toBeChecked();
    await expect(badge(page).locator("[data-avatar]")).toHaveAttribute("data-avatar", "moon");
    expect(saves).toEqual([]);
    const saved = await (await page.request.get("/api/me", { headers: { "x-demo-user": user } })).json();
    expect(saved).toMatchObject({ avatar: "moon", visibility: { workplace: false } });
  });

  test("a source changed on page one starts a new import instead of keeping the old one", async ({ page }) => {
    const user = await asNewGoogleUser(page);
    await startImport(page);
    const original = (await owner(page, user)).job.jobId;
    await page.goto("/signin");
    await toggle(page, "Research papers");
    await continueButton(page).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose what Lanyard reads");
    await expect(page.getByRole("switch", { name: "Research papers", exact: true })).not.toBeChecked();
    const starts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/api/profile-enrichment") starts.push(r.url());
    });
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    expect(starts).toHaveLength(1);
    expect((await owner(page, user)).job.jobId).not.toBe(original);
  });

  test("page four keeps reading the import after one failed read", async ({ page }) => {
    await asNewGoogleUser(page);
    await startImport(page);
    await page.locator("label").filter({ hasText: "Not right now" }).click();
    let reads = 0;
    await page.route(/\/api\/profile-enrichment\/[^/]+$/, (route) =>
      ++reads === 2 ? route.fulfill({ status: 503, json: { error: "Unavailable", code: "provider_down" } }) : route.continue(),
    );
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/onboarding\/free-time$/);
    await expect(shown(page, "Your sources have been read. You'll check your bio next.")).toBeVisible({ timeout: 20_000 });
    expect(reads).toBeGreaterThan(2);
  });

  test("with no import running, page four shows no import status", async ({ page }) => {
    await asNewGoogleUser(page);
    await page.goto("/signin");
    await page.getByLabel("Your name").fill("Ada Lovelace");
    await page.getByRole("textbox", { name: "Workplace" }).fill("Analytical Engines");
    await page.getByLabel("Country").selectOption("GB");
    for (const source of ["GitHub", "Research papers", "Public profile page"]) await toggle(page, source);
    await continueButton(page).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose what Lanyard reads");
    await continueButton(page).click(); // every source off: the manual flow, no import
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.locator("label").filter({ hasText: "Not right now" }).click();
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/onboarding\/free-time$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("When are you free?");
    await expect(page.getByRole("status").filter({ hasText: /sources/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  });
});
