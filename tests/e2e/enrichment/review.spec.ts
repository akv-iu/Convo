/**
 * Profile enrichment page five (/onboarding/profile with PROFILE_ENRICHMENT_ENABLED=1):
 * wait for the import, review the draft, approve it. Each test is its own fresh
 * Google-only fixture (u_google_new_<suffix>); the import is started through the
 * fake API, as pages one and two would, so these tests start on page five.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const READY = 20_000; // the fake advances a job each time it's read; the page polls every two seconds

interface Setup {
  name?: string;
  onboard?: boolean;
  hide?: Partial<Record<"country" | "workplace" | "hiring", boolean>>;
  cv?: boolean;
}

async function send(page: Page, user: string, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const response = await page.request.fetch(path, {
    method, headers: { "x-demo-user": user }, ...(data instanceof FormData ? { multipart: data } : data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${method} ${path}`).toBe(true);
  return response.json();
}

/** A fresh Google user who chose all four sources on pages one and two. Returns their ID and job ID. */
async function startImport(page: Page, { name = "Ada Lovelace", onboard = true, hide = {}, cv = true }: Setup = {}) {
  const user = `u_google_new_${test.info().project.name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await page.setExtraHTTPHeaders({ "x-demo-user": user });
  if (onboard) {
    await send(page, user, "PUT", "/api/me", {
      filters: { country: "GB", rorId: null, hiring: true }, workplaceName: "Analytical Engines",
      visibility: { country: true, workplace: true, hiring: true, ...hide },
    });
  }
  const identity = { name, country: "GB", workplaceName: "Analytical Engines", rorId: null, orcid: null };
  await send(page, user, "PUT", "/api/profile-enrichment", identity);
  await send(page, user, "POST", "/api/profile-enrichment/github/connect", {});
  const found = await send(page, user, "POST", "/api/profile-enrichment/discover", { source: "research", name, workplaceName: identity.workplaceName, rorId: null, orcid: null });
  let upload: { uploadId: string } | null = null;
  if (cv) {
    const form = new FormData();
    form.set("consent", "true");
    form.set("text", "Postdoctoral researcher in quantum hardware.");
    upload = await send(page, user, "POST", "/api/profile-enrichment/cv", form);
  }
  const job = await send(page, user, "POST", "/api/profile-enrichment", {
    identity, idempotencyKey: crypto.randomUUID(),
    github: { import: true, bio: true, repos: true, orgs: true },
    research: { discoveryId: found.discoveryId, candidateId: found.candidates[0].id },
    publicProfile: { kind: "text", text: "Ada builds reliable systems." },
    cv: upload ? { uploadId: upload.uploadId } : null,
  });
  return { user, jobId: job.jobId as string };
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const evidence = (page: Page, name: string) => page.getByRole("checkbox", { name: new RegExp(`^${name}`) });

async function toReview(page: Page) {
  await page.goto("/onboarding/profile");
  await expect(page.getByText("Step 5 of 5")).toBeVisible();
  await expect(heading(page)).toHaveText("Check your bio", { timeout: READY });
}

async function scan(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== "running"),
    );
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, `${label} (${colorScheme})`).toEqual([]);
  }
}

test.describe("profile enrichment: review and approve", () => {
  test("waits for the import, then approves an edited bio, expertise and the chosen evidence", async ({ page }) => {
    const { user, jobId } = await startImport(page);
    await page.goto("/onboarding/profile");
    await expect(page.getByText("Step 5 of 5")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Reading your sources" })).toBeVisible();
    await expect(heading(page)).toHaveText("Check your bio", { timeout: READY });
    await scan(page, "draft review");

    const bio = page.getByRole("textbox", { name: "Bio" });
    await expect(bio).toHaveValue("Works on reliable systems. Enjoys sharing practical experience.");
    await expect(evidence(page, "CV excerpt")).not.toBeChecked(); // CV excerpts start unselected
    await expect(evidence(page, "Recorded research example")).toBeChecked();
    await expect(evidence(page, "Text you pasted")).toBeChecked();
    const removedWarning = page.getByText("Some of what your bio says came from evidence you removed");
    await expect(removedWarning).toHaveCount(0); // nothing unticked yet, though the CV starts unticked

    await bio.fill("I build reliable systems and calibrate qubits.");
    await page.getByRole("button", { name: "Remove Reliable systems from your profile" }).click();
    await page.getByRole("textbox", { name: "Add expertise" }).fill("Qubit calibration");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await evidence(page, "CV excerpt").check();
    await evidence(page, "Recorded research example").uncheck();
    await expect(removedWarning).toBeVisible();

    await page.getByRole("button", { name: "Approve and continue" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Your bio is approved." })).toBeVisible();
    await expect(heading(page)).toHaveText("Are these the correct details?");
    await expect(page.getByText("I build reliable systems and calibrate qubits.").filter({ visible: true })).toHaveCount(1); // on the badge

    expect((await send(page, user, "GET", `/api/profile-enrichment/${jobId}`)).state).toBe("accepted");
    const me = await send(page, user, "GET", "/api/me");
    expect([me.bio, me.expertise]).toEqual(["I build reliable systems and calibrate qubits.", ["Qubit calibration"]]);
    const sources = await send(page, user, "GET", "/api/profile-enrichment/sources");
    expect(Object.fromEntries(sources.map((s: { source: string; evidenceCount: number }) => [s.source, s.evidenceCount])))
      .toMatchObject({ research: 0, cv: 1, public_profile: 1 });
  });

  test("warns, without blocking, when the bio mentions something hidden from the card", async ({ page }) => {
    await startImport(page, { hide: { country: false } });
    await toReview(page);
    await page.getByRole("textbox", { name: "Bio" }).fill("Based in the United Kingdom, building reliable systems.");
    await expect(page.getByText("Your bio mentions your country (United Kingdom)")).toBeVisible();
    await page.getByRole("button", { name: "Approve and continue" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Your bio is approved." })).toBeVisible();
  });

  test("a bio edited after the draft was written is kept, never replaced", async ({ page }) => {
    const { user, jobId } = await startImport(page);
    for (let i = 0; i < 4; i++) await send(page, user, "GET", `/api/profile-enrichment/${jobId}`); // let the job finish
    await send(page, user, "PUT", "/api/me", { bio: "My own words." });
    await toReview(page);
    await expect(page.getByText("You changed your bio after this draft was written")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve and continue" })).toHaveCount(0);
    await page.getByRole("button", { name: "Keep my bio" }).click();
    await expect(heading(page)).toHaveText("Are these the correct details?");
    await expect(page.getByText("My own words.").filter({ visible: true })).toHaveCount(1); // on the badge
    expect((await send(page, user, "GET", `/api/profile-enrichment/${jobId}`)).state).toBe("cancelled");
  });

  test("a stuck import offers Try again, and a partly failed one can still be approved", async ({ page }) => {
    await startImport(page, { name: "Ada [demo:stalled]" });
    await page.goto("/onboarding/profile");
    await expect(heading(page)).toHaveText("Your bio", { timeout: READY });
    await expect(page.getByText("Reading your sources stopped before it finished")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(heading(page)).toHaveText("Check your bio", { timeout: READY });

    await startImport(page, { name: "Ada [demo:partial]" });
    await toReview(page);
    await expect(page.getByText("Some sources didn't work")).toBeVisible();
    await page.getByRole("button", { name: "Approve and continue" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Your bio is approved." })).toBeVisible();
  });

  test("writing your own bio discards the draft and shows the usual details page", async ({ page }) => {
    const { user, jobId } = await startImport(page);
    await toReview(page);
    await page.getByRole("button", { name: "Write my own bio instead" }).click();
    await page.getByRole("button", { name: "Keep reviewing" }).click(); // changing your mind keeps the draft
    await expect(heading(page)).toHaveText("Check your bio");
    await page.getByRole("button", { name: "Write my own bio instead" }).click();
    await page.getByRole("button", { name: "Discard the draft" }).click();
    await expect(heading(page)).toHaveText("Are these the correct details?");
    expect((await send(page, user, "GET", `/api/profile-enrichment/${jobId}`)).state).toBe("cancelled");
  });

  test("a save search hasn't caught up with is retried with the same approval", async ({ page }) => {
    await startImport(page);
    await toReview(page);
    const bodies: string[] = [];
    await page.route("**/api/profile-enrichment/*/accept", async (route) => {
      bodies.push(route.request().postData() ?? "");
      if (bodies.length > 1) return route.continue();
      await route.fulfill({ json: { person: null, sync: { status: "pending", retryable: true, savedRevision: 3 } } });
    });
    await page.getByRole("button", { name: "Approve and continue" }).click();
    await expect(page.getByText("Your bio is saved, but your matches may not show it yet")).toBeVisible();
    await page.getByRole("button", { name: "Update my matches" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Your bio is approved." })).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]); // the identical body repairs the saved approval
  });

  test("approving before the badge is finished saves it and says what's left", async ({ page }) => {
    await startImport(page, { onboard: false });
    await toReview(page);
    await page.getByRole("button", { name: "Approve and continue" }).click();
    await expect(page.getByText("Your bio is saved. Finish your badge to publish it.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to your badge" })).toHaveAttribute("href", "/onboarding");
  });

  test("if the import can't be read, page five says so and still lets you check your details", async ({ page }) => {
    await startImport(page);
    await page.route("**/api/profile-enrichment", (route) => route.fulfill({ status: 503, json: { error: "Unavailable", code: "provider_down" } }));
    await page.goto("/onboarding/profile");
    await expect(heading(page)).toHaveText("Your bio");
    await expect(page.getByRole("alert").filter({ hasText: "Your profile didn't load. Try again in a moment." })).toBeVisible();
    await page.getByRole("button", { name: "Check my details without it" }).click();
    await expect(heading(page)).toHaveText("Are these the correct details?");
  });

  test("with no import to review, page five is the usual details page", async ({ page }) => {
    const user = `u_google_new_${test.info().project.name}_${Date.now().toString(36)}_none`;
    await page.setExtraHTTPHeaders({ "x-demo-user": user });
    await send(page, user, "PUT", "/api/me", { filters: { country: "GB", rorId: null, hiring: true } });
    await page.goto("/onboarding/profile");
    await expect(page.getByText("Step 5 of 5")).toBeVisible();
    await expect(heading(page)).toHaveText("Are these the correct details?");
  });
});
