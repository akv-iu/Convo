/**
 * Profile enrichment pages one and two, with PROFILE_ENRICHMENT_ENABLED=1 on
 * the fake API. Each test signs in as its own fresh Google-only fixture
 * (u_google_new_<suffix>), so tests never share jobs, uploads or connections.
 * The fake's recorded triggers ([demo:…] in the name, DEMO:LONG in a file)
 * stand in for provider outcomes.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ORCID = "0000-0002-1825-0097";

async function asNewGoogleUser(page: Page): Promise<string> {
  const user = `u_google_new_${test.info().project.name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await page.setExtraHTTPHeaders({ "x-demo-user": user });
  return user;
}

async function api(page: Page, user: string, path = "") {
  const response = await page.request.get(`/api/profile-enrichment${path}`, { headers: { "x-demo-user": user } });
  expect(response.ok()).toBe(true);
  return response.json();
}

/** A switch's whole row is its label; tap that, as a person would. */
async function toggle(page: Page, name: string) {
  await page.locator("label").filter({ has: page.getByRole("switch", { name, exact: true }) }).click();
}

async function fillDetails(page: Page, name = "Ada Lovelace") {
  await page.goto("/signin");
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("textbox", { name: "Workplace" }).fill("Analytical Engines");
  await page.getByLabel("Country").selectOption("GB");
}

async function toSources(page: Page) {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/signin\/sources$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose what Lanyard reads");
}

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

async function scan(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Switching scheme on a loaded page runs colour transitions; measure the settled colours.
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== "running"),
    );
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, `${label} (${colorScheme})`).toEqual([]);
  }
}

test.describe("profile enrichment: details and sources", () => {
  test("a Google-only person picks an author, pastes profile text, uploads a CV and continues", async ({ page }) => {
    const user = await asNewGoogleUser(page);
    await fillDetails(page);
    await page.getByLabel(/ORCID iD/).fill(`https://orcid.org/${ORCID}`);
    await toggle(page, "GitHub");
    await toggle(page, "CV");
    await scan(page, "details");
    await toSources(page);
    await expect(page.getByText("Signed in with Google.", { exact: false })).toBeVisible();

    // Page one's answers were saved privately, so another tab can resume.
    const owner = await api(page, user);
    expect(owner.identity).toEqual({ name: "Ada Lovelace", country: "GB", workplaceName: "Analytical Engines", rorId: null, orcid: ORCID });

    const research = region(page, "Research papers");
    await expect(research.getByRole("radio")).toHaveCount(5); // four suggestions and None of these
    const link = research.getByRole("link", { name: /View Ada Lovelace \(demo 1\) on OpenAlex/ });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(research.getByRole("radio", { checked: true })).toHaveCount(0); // nothing chosen for you
    await research.getByRole("radio", { name: /Ada Lovelace \(demo 2\)/ }).check();

    const profile = region(page, "Public profile page");
    await expect(profile.getByRole("radio", { name: /demo profile 4/ })).toBeVisible();
    await profile.getByRole("radio", { name: "Paste text instead" }).check();
    await profile.getByRole("textbox", { name: "Text about your professional work" }).fill("Designs engines and writes about computation.");

    const cv = region(page, "CV");
    await cv.getByLabel(/Upload a PDF or Word file/).setInputFiles({ name: "ada-cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nRecorded test CV\n") });
    await expect(cv.getByText("ada-cv.pdf")).toBeVisible();
    await scan(page, "sources");

    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding$/);

    const started = await api(page, user);
    expect(started.job).not.toBeNull();
    const job = await api(page, user, `/${started.job.jobId}`);
    const snapshot = Object.fromEntries(job.sources.map((s: { source: string; status: string; selection: unknown }) => [s.source, s]));
    expect(snapshot.github.status).toBe("not_selected");
    expect(snapshot.research.selection.label).toBe("Ada Lovelace (demo 2)");
    expect(snapshot.public_profile.selection.label).toBe("Profile text");
    expect(snapshot.cv.selection.filename).toBe("ada-cv.pdf");

    // Coming back offers the running import instead of starting another.
    await page.goto("/signin/sources");
    await expect(page.getByText("Your sources are already being read")).toBeVisible();
    await page.getByRole("link", { name: "Continue to your badge" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    expect((await api(page, user)).job.jobId).toBe(started.job.jobId);
  });

  test("Continue explains what's missing, and GitHub connects to the same account", async ({ page }) => {
    const user = await asNewGoogleUser(page);
    await fillDetails(page);
    await toggle(page, "CV");
    await toSources(page);

    const github = region(page, "GitHub");
    await expect(github.getByText("Not connected to this account.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/signin\/sources$/);
    await expect(github.getByText("Connect GitHub, or turn off GitHub.")).toBeVisible();
    await expect(region(page, "CV").getByText("Upload your CV or paste its text, or turn off CV.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeFocused();

    // Back from a cancelled connection: the reason shows until GitHub connects.
    await page.goto("/signin/sources?reason=github_connect_cancelled");
    await expect(page.getByText("GitHub wasn't connected")).toBeVisible();
    await page.getByRole("button", { name: "Connect GitHub" }).click();
    await expect(github.getByText("Connected as @demo-connected.", { exact: false })).toBeVisible();
    await expect(page.getByText("GitHub wasn't connected")).toHaveCount(0);
    const owner = await api(page, user);
    expect(owner.signIn.provider).toBe("google"); // connecting never switches the account
    expect(owner.github).toEqual({ connected: true, login: "demo-connected" });

    await toggle(page, "CV");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test("coming back from GitHub keeps page two's choices", async ({ page }) => {
    await asNewGoogleUser(page);
    await fillDetails(page);
    await toSources(page);
    const research = region(page, "Research papers");
    await research.getByRole("radio", { name: /Ada Lovelace \(demo 2\)/ }).check();
    const profile = region(page, "Public profile page");
    await profile.getByRole("radio", { name: "Paste text instead" }).check();
    await profile.getByRole("textbox", { name: "Text about your professional work" }).fill("Designs engines.");

    // The real connection leaves for GitHub; here it comes straight back, cancelled.
    await page.route("**/api/profile-enrichment/github/connect", (route) =>
      route.fulfill({ json: { status: "redirect", path: "/api/auth/connect/github?token=test" } }),
    );
    await page.route(
      (url) => url.pathname === "/api/auth/connect/github",
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<script>location.replace('/signin/sources?reason=github_connect_cancelled')</script>",
        }),
    );
    const searches: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/profile-enrichment/discover")) searches.push(r.url());
    });
    await page.getByRole("button", { name: "Connect GitHub" }).click();
    await expect(page).toHaveURL(/reason=github_connect_cancelled/);
    await expect(page.getByText("GitHub wasn't connected")).toBeVisible();
    await expect(research.getByRole("radio", { name: /Ada Lovelace \(demo 2\)/ })).toBeChecked();
    await expect(profile.getByRole("textbox", { name: "Text about your professional work" })).toHaveValue("Designs engines.");
    expect(searches).toEqual([]); // the kept suggestions, not new ones with different IDs
    expect(await page.evaluate(() => sessionStorage.getItem("convo_enrichment_return"))).toBeNull();
  });

  test("a GitHub that belongs to another account is refused with help", async ({ page }) => {
    await asNewGoogleUser(page);
    await fillDetails(page, "Ada [demo:linked_elsewhere]");
    await toSources(page);
    await page.getByRole("button", { name: "Connect GitHub" }).click();
    const github = region(page, "GitHub");
    await expect(github.getByText("This GitHub already belongs to another Lanyard account")).toBeVisible();
    await github.getByText("How to fix this").click();
    await expect(github.getByText("Sign in with that GitHub instead", { exact: false })).toBeVisible();
  });

  test("a Connect GitHub reply that points anywhere but sign-in is refused, not followed", async ({ page }) => {
    await asNewGoogleUser(page);
    await page.route((url) => url.hostname !== "localhost", (route) => route.abort()); // never leave for a real site
    await fillDetails(page);
    await toSources(page);
    const paths = ["https://lanyard.invalid/api/auth/connect/github", "//lanyard.invalid/api/auth/", "/onboarding"];
    let replies = 0;
    await page.route("**/api/profile-enrichment/github/connect", (route) =>
      route.fulfill({ json: { status: "redirect", path: paths[replies++] } }),
    );
    const github = region(page, "GitHub");
    for (let i = 1; i <= paths.length; i++) {
      await page.getByRole("button", { name: "Connect GitHub" }).click();
      await expect.poll(() => replies).toBe(i);
      await expect(github.getByText("This import isn't available")).toBeVisible();
      await expect(page).toHaveURL(/\/signin\/sources$/);
    }
    await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeVisible(); // not stuck on "Connecting…"
  });

  test("unavailable and empty searches say so, and searching again works", async ({ page }) => {
    await asNewGoogleUser(page);
    await fillDetails(page, "Ada [demo:unavailable]");
    await toggle(page, "GitHub");
    await toSources(page);
    const research = region(page, "Research papers");
    await expect(research.getByText("This service isn't available right now")).toBeVisible();
    await expect(research.getByRole("button", { name: "Try again" })).toBeVisible();
    const profile = region(page, "Public profile page");
    await expect(profile.getByRole("radio", { name: "Use a different link" })).toBeVisible();

    await page.getByRole("link", { name: "Back to About you" }).click();
    await expect(page.getByLabel("Your name")).toHaveValue("Ada [demo:unavailable]"); // coming back keeps answers
    await page.getByLabel("Your name").fill("Ada [demo:no_matches]");
    await toSources(page);
    await expect(research.getByText("No confident match among research authors")).toBeVisible();
    await expect(profile.getByText("No pages found. Give a link or paste text instead.")).toBeVisible();
    await expect(page.getByRole("switch", { name: "GitHub", exact: true })).not.toBeChecked(); // source choices kept too
  });

  test("a different link must be HTTPS, and pasted text can't be empty", async ({ page }) => {
    await asNewGoogleUser(page);
    await fillDetails(page);
    await toggle(page, "GitHub");
    await toSources(page);
    const profile = region(page, "Public profile page");
    await profile.getByRole("radio", { name: "Use a different link" }).check();
    await profile.getByRole("textbox", { name: "Link to your public profile page" }).fill("http://example.org/ada");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(profile.getByText("Enter the full link, starting with https://.")).toBeVisible();
    await expect(profile.getByRole("textbox", { name: "Link to your public profile page" })).toBeFocused();

    await profile.getByRole("radio", { name: "Paste text instead" }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(profile.getByText("Paste some text, or choose another option.")).toBeVisible();

    await profile.getByRole("radio", { name: "Use a different link" }).check();
    await profile.getByRole("textbox", { name: "Link to your public profile page" }).fill("https://example.org/ada");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test("CV problems get specific help, and removing or switching off discards the upload", async ({ page }) => {
    const user = await asNewGoogleUser(page);
    await fillDetails(page);
    await toggle(page, "GitHub");
    await toggle(page, "CV");
    await toSources(page);
    const cv = region(page, "CV");
    const file = cv.getByLabel(/Upload a PDF or Word file/);

    await file.setInputFiles({ name: "cv.txt", mimeType: "text/plain", buffer: Buffer.from("plain text") });
    await expect(cv.getByText("Only PDF and Word (.docx) files work")).toBeVisible();

    await file.setInputFiles({ name: "long.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nDEMO:LONG\n") });
    await expect(cv.getByText("Only the first 30,000 characters were kept")).toBeVisible();
    await expect(cv.getByText("30,000 characters ready to read")).toBeVisible();

    await cv.getByRole("button", { name: "Remove" }).click();
    await expect(file).toBeVisible();
    expect((await api(page, user)).pendingCv).toBeNull();

    await cv.getByRole("textbox", { name: "CV text" }).fill("Engineer. Writes about computation.");
    await cv.getByRole("button", { name: "Use this text" }).click();
    await expect(cv.getByText("Pasted CV text")).toBeVisible();
    expect((await api(page, user)).pendingCv).toMatchObject({ filename: null });

    await toggle(page, "CV");
    await expect.poll(async () => (await api(page, user)).pendingCv).toBeNull();
  });

  test("CV off never leaves a CV staged, and a failed removal turns only CV back on", async ({ page }) => {
    const user = await asNewGoogleUser(page);
    await fillDetails(page);
    await toggle(page, "GitHub");
    await toggle(page, "CV");
    await toSources(page);
    const cv = region(page, "CV");
    const pending = async () => (await api(page, user)).pendingCv;
    async function useText() {
      await cv.getByRole("textbox", { name: "CV text" }).fill("Engineer. Writes about computation.");
      await cv.getByRole("button", { name: "Use this text" }).click();
    }

    // Turned off while the upload is on its way: the finished upload is discarded.
    let deliver!: () => void;
    const held = new Promise<void>((resolve) => (deliver = resolve));
    await page.route("**/api/profile-enrichment/cv", async (route) => {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
    });
    await useText();
    await expect(cv.getByText("Uploading…")).toBeVisible();
    await toggle(page, "CV");
    const uploaded = page.waitForResponse("**/api/profile-enrichment/cv");
    deliver();
    await uploaded;
    await expect.poll(pending).toBeNull();
    await page.unroute("**/api/profile-enrichment/cv");

    // Removal fails while another switch changes: CV comes back on, Research papers stays off.
    await toggle(page, "CV");
    await useText();
    await expect(cv.getByText("Pasted CV text")).toBeVisible();
    let fail!: () => void;
    const failing = new Promise<void>((resolve) => (fail = resolve));
    await page.route("**/api/profile-enrichment/cv/*/remove", async (route) => {
      await failing;
      await route.fulfill({ status: 503, json: { error: "Unavailable", code: "provider_down" } });
    });
    const removing = page.waitForRequest("**/api/profile-enrichment/cv/*/remove");
    await toggle(page, "CV");
    await removing;
    await toggle(page, "Research papers");
    fail();
    await expect(cv.getByText("Your uploaded CV couldn't be removed, so CV is still on. Try again.")).toBeVisible();
    await expect(page.getByRole("switch", { name: "CV", exact: true })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Research papers", exact: true })).not.toBeChecked();
    await page.unroute("**/api/profile-enrichment/cv/*/remove");
    expect(await pending()).not.toBeNull();

    // Turned off on page one: page two discards it.
    await page.getByRole("link", { name: "Back to About you" }).click();
    // Page two has the same switches in the same states, so wait for page one before using them;
    // otherwise the next tap can land on page two's switch just as it's hidden.
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByRole("switch", { name: "CV", exact: true })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Research papers", exact: true })).not.toBeChecked();
    await toggle(page, "CV");
    await toSources(page);
    await expect(page.getByRole("switch", { name: "CV", exact: true })).not.toBeChecked();
    await expect.poll(pending).toBeNull();
  });

  test("an older tab's Continue refreshes to the identity a newer tab saved, and never writes over it", async ({ page, context }) => {
    const user = await asNewGoogleUser(page);
    await fillDetails(page);
    await toggle(page, "GitHub");
    await toSources(page);

    const newer = await context.newPage();
    await newer.setExtraHTTPHeaders({ "x-demo-user": user });
    await fillDetails(newer, "Ada King");
    await toggle(newer, "GitHub");
    await toSources(newer);
    expect((await api(page, user)).identity.name).toBe("Ada King");

    const searchedAgain = page.waitForRequest((r) => r.url().endsWith("/api/profile-enrichment/discover") && r.postDataJSON()?.source === "research");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText("Something changed since this page loaded", { exact: false })).toBeVisible();
    expect((await searchedAgain).postDataJSON().name).toBe("Ada King");
    expect((await api(page, user)).identity.name).toBe("Ada King");

    // Reloading the older tab doesn't write its copy back either.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose what Lanyard reads");
    expect((await api(page, user)).identity.name).toBe("Ada King");
  });

  test("on phones, keyboard focus never lands under the sticky Continue", async ({ page }) => {
    test.skip(!test.info().project.name.endsWith("phone"), "Continue is sticky only on phones");
    /** Tabs to Continue; returns each field or link that was focused but sat under the bar. */
    async function coveredOnTheWay(): Promise<string[]> {
      const covered: string[] = [];
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press("Tab");
        const found = await page.evaluate(() => {
          const bar = document.querySelector("main .sticky");
          const el = document.activeElement;
          if (!bar || !el) return "lost";
          if (bar.contains(el)) return "bar";
          if (el === document.body) return null; // nothing focused for this press
          const under = el.getBoundingClientRect().bottom > bar.getBoundingClientRect().top + 0.5;
          return under ? (el.getAttribute("aria-label") ?? el.id ?? el.tagName).slice(0, 60) || el.tagName : null;
        });
        if (found === "bar") return covered;
        if (found === "lost") throw new Error("No sticky bar or focus");
        if (found) covered.push(found);
      }
      throw new Error("Tab never reached Continue");
    }

    await asNewGoogleUser(page);
    await page.goto("/signin");
    await expect(page.getByLabel("Your name")).toBeVisible();
    expect(await coveredOnTheWay()).toEqual([]);

    await fillDetails(page);
    await toSources(page);
    await expect(region(page, "Research papers").getByRole("radio")).toHaveCount(5);
    expect(await coveredOnTheWay()).toEqual([]);
  });

  test("signed out, page two offers Google and GitHub, and shows only known reasons", async ({ page }) => {
    await page.route("**/api/profile-enrichment", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 401, json: { error: "Sign in first.", code: "sign_in_required" } })
        : route.continue(),
    );
    await page.goto("/signin/sources?reason=sign_in_cancelled");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
    await expect(page.getByText("Sign-in was cancelled")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
    await scan(page, "signed out");

    await page.goto("/signin/sources?reason=%3Cscript%3E");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
    await expect(page.getByText("How to fix this")).toHaveCount(0);
  });

  test("page one checks the ORCID iD and GitHub's choices before moving on", async ({ page }) => {
    await asNewGoogleUser(page);
    await fillDetails(page);
    await page.getByLabel(/ORCID iD/).fill("0000-0002-1825-0098");
    for (const item of ["Bio", "Repos and languages", "Organisations"]) await page.getByRole("checkbox", { name: item }).uncheck();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByText("That isn't a valid ORCID iD.", { exact: false })).toBeVisible();
    await expect(page.getByText("Choose at least one, or turn off GitHub.")).toBeVisible();
    await expect(page.getByLabel(/ORCID iD/)).toBeFocused();
  });

  test("a returning account can keep its profile, and this tab forgets the journey", async ({ page }) => {
    const user = await asNewGoogleUser(page);
    const saved = await page.request.put("/api/me", { headers: { "x-demo-user": user },
      data: { filters: { country: "GB", rorId: null, hiring: true }, workplaceName: "Analytical Engines" } });
    expect(saved.ok()).toBe(true); // already onboarded
    await fillDetails(page);
    await toSources(page);
    await expect(page.getByText("You already have a profile")).toBeVisible();
    await page.getByRole("link", { name: "Keep my profile" }).click();
    await expect(page).toHaveURL(/\/ask$/);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => /^convo_(onboarding|enrichment)_/.test(k)))).toEqual([]);
  });
});
