import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * A1 step 5: the ask box, on the fake API (canned AI: deterministic, free,
 * and "idiot" stands in for a moderation block). Send saves the question as
 * written; Sharpen with AI only suggests, and saves nothing.
 */

const AFTER_SUBMIT = 15_000;

const box = (page: Page) => page.getByRole("textbox", { name: "What do you want to ask?" });
const send = (page: Page) => page.getByRole("button", { name: "Send", exact: true });
const sharpen = (page: Page) => page.getByRole("button", { name: /^Sharpen (with AI|again)$/ });
const isSave = (req: Request) => req.url().endsWith("/api/asks") && req.method() === "POST";
const isPreview = (req: Request) => req.url().endsWith("/api/refine/preview") && req.method() === "POST";
const isOldRefine = (req: Request) => req.url().endsWith("/api/refine") && req.method() === "POST";
const alertWithText = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

async function open(page: Page, person = "p_003") {
  await page.setExtraHTTPHeaders({ "x-demo-user": person });
  await page.goto("/ask");
  await expect(box(page)).toBeVisible();
}

/** Every request the ask box makes, so tests can check what was (and wasn't) sent. */
function watch(page: Page) {
  const seen: Request[] = [];
  page.on("request", (r) => {
    if (isSave(r) || isPreview(r) || isOldRefine(r)) seen.push(r);
  });
  return seen;
}

test.describe("ask as written, sharpening optional (A1 step 5)", () => {
  test("Send saves the question exactly as written, as a 5-minute chat to learn something", async ({ page }) => {
    await open(page);
    const seen = watch(page);
    await box(page).fill("how does Raft do the voting thing");
    const saving = page.waitForRequest(isSave);
    await send(page).click();
    expect((await saving).postDataJSON()).toEqual({ text: "how does Raft do the voting thing", type: "knowledge" });

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Current request");
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page.locator("blockquote")).toHaveText("how does Raft do the voting thing");
    await expect(page.getByText("Learn something")).toBeVisible();
    await expect(page.getByText("5-minute chat")).toBeVisible();
    await expect(page.getByText("You first wrote:")).toHaveCount(0); // nothing was sharpened
    expect(seen.filter((r) => isPreview(r) || isOldRefine(r))).toHaveLength(0); // no AI rewrite

    const href = await page.getByRole("link", { name: "Find people" }).getAttribute("href");
    const askId = new URL(href!, "http://x").searchParams.get("ask")!;
    // The server saved exactly that: read it back and match it.
    const saved = await (await page.request.get(`/api/asks/${askId}`, { headers: { "x-demo-user": "p_003" } })).json();
    expect(saved).toMatchObject({ rawText: "how does Raft do the voting thing", refined: { text: "how does Raft do the voting thing" }, softBlocker: false });
    const match = await page.request.post("/api/match", { headers: { "x-demo-user": "p_003" }, data: { askId } });
    expect(match.ok()).toBe(true);
  });

  test("Sharpen suggests a question without saving it; edit the suggestion, then send that", async ({ page }) => {
    await open(page);
    const seen = watch(page);
    await box(page).fill("I want a job at Stripe");
    const previewing = page.waitForRequest(isPreview);
    await sharpen(page).click();
    expect((await previewing).postDataJSON()).toEqual({ text: "I want a job at Stripe" });
    await expect(box(page)).toHaveValue(/^I want a job at Stripe: /);
    await expect(page.getByText("Sharpened with AI.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Career move" })).toBeChecked(); // the suggestion's type
    expect(seen.filter(isSave)).toHaveLength(0); // a preview saves nothing

    await box(page).fill("I want a job at Stripe. What did you do before joining?");
    const saving = page.waitForRequest(isSave);
    await send(page).click();
    expect((await saving).postDataJSON()).toEqual({ text: "I want a job at Stripe. What did you do before joining?", type: "career" });
    await expect(page.locator("blockquote")).toHaveText("I want a job at Stripe. What did you do before joining?");
    await expect(page.getByText("Career move")).toBeVisible();
    await expect(page.getByText("You first wrote:")).toBeVisible();
    expect(seen.filter(isSave)).toHaveLength(1);
  });

  test("Use my original puts your own words back, and that's what's sent", async ({ page }) => {
    await open(page);
    await box(page).fill("how does etcd store keys");
    await sharpen(page).click();
    await expect(page.getByText("Sharpened with AI.")).toBeVisible();
    await page.getByRole("button", { name: "use my original" }).click();
    await expect(box(page)).toHaveValue("how does etcd store keys");
    await expect(box(page)).toBeFocused();
    await expect(page.getByText("Sharpened with AI.")).toHaveCount(0);
    const saving = page.waitForRequest(isSave);
    await send(page).click();
    expect((await saving).postDataJSON()).toMatchObject({ text: "how does etcd store keys" });
  });

  test("you can pick the kind of question before sending", async ({ page }) => {
    await open(page);
    await box(page).fill("anyone want to build a Raft visualiser with me");
    await page.getByRole("radio", { name: "Build together" }).check({ force: true });
    const saving = page.waitForRequest(isSave);
    await send(page).click();
    expect((await saving).postDataJSON()).toEqual({ text: "anyone want to build a Raft visualiser with me", type: "collaboration" });
    await expect(page.getByText("Build together")).toBeVisible();
  });

  test("too short is explained and nothing is sent, by either button", async ({ page }) => {
    await open(page);
    const seen = watch(page);
    await box(page).fill("hi");
    await send(page).click();
    await expect(page.getByText("Write a few words about what you want to ask.")).toBeVisible();
    await expect(box(page)).toBeFocused();
    await sharpen(page).click();
    expect(seen).toHaveLength(0);
  });

  test("a blocked ask shows the reason, keeps the text, and nothing is saved", async ({ page }) => {
    await open(page);
    await box(page).fill("why is my manager such an idiot");
    await send(page).click();
    await expect(alertWithText(page)).toContainText("looks offensive or unsafe");
    await expect(box(page)).toHaveValue("why is my manager such an idiot");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("What do you want to ask?");
    // Sharpening it is refused the same way.
    await sharpen(page).click();
    await expect(alertWithText(page)).toContainText("looks offensive or unsafe");
    await expect(box(page)).toHaveValue("why is my manager such an idiot");
  });

  test("a failed send can be retried, and only one save is in flight", async ({ page }) => {
    await open(page);
    let calls = 0;
    await page.route("**/api/asks", async (route) => {
      calls++;
      if (calls === 1) {
        await new Promise((r) => setTimeout(r, 400));
        return route.fulfill({ status: 503, json: { error: "Lanyard is busy. Try again." } });
      }
      return route.fallback();
    });
    await box(page).fill("how does etcd store keys");
    await send(page).click();
    const sending = page.getByRole("button", { name: "Sending…" });
    await expect(sending).toHaveAttribute("aria-disabled", "true");
    await sending.click({ force: true }); // a second press while saving does nothing
    await expect(alertWithText(page)).toHaveText("Lanyard is busy. Try again.");
    expect(calls).toBe(1);
    await send(page).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Current request", { timeout: AFTER_SUBMIT });
    expect(calls).toBe(2);
  });

  test("a failed sharpen keeps your words and says you can still send them", async ({ page }) => {
    await open(page);
    await page.route("**/api/refine/preview", (route) => route.fulfill({ status: 503, json: { error: "Question refinement is unavailable. Try again." } }));
    await box(page).fill("how does etcd store keys");
    await sharpen(page).click();
    await expect(alertWithText(page)).toHaveText("Question refinement is unavailable. Try again. You can still send it as written.");
    await expect(box(page)).toHaveValue("how does etcd store keys");
    await send(page).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Current request", { timeout: AFTER_SUBMIT });
  });

  test("an unfinished profile is sent to set up first", async ({ page }) => {
    await open(page);
    await page.route("**/api/asks", (route) => route.fulfill({ status: 409, json: { error: "Complete onboarding first." } }));
    await box(page).fill("how does etcd store keys");
    await send(page).click();
    await expect(alertWithText(page)).toContainText("Finish setting up your badge first.");
    await expect(page.getByRole("link", { name: "Set up your badge" })).toHaveAttribute("href", "/signin");
  });

  test("Ask something else goes back with the text kept", async ({ page }) => {
    await open(page);
    await box(page).fill("how does Raft do the voting thing");
    await send(page).click();
    await page.getByRole("button", { name: "Ask something else" }).click();
    await expect(box(page)).toBeFocused();
    await expect(box(page)).toHaveValue("how does Raft do the voting thing");
  });

  test("works with the keyboard alone: Ctrl+Enter sends as written", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await open(page);
    await page.keyboard.press("Tab"); // skip link
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await box(page).focus();
    await page.keyboard.type("how does the scheduler do preemption");
    const saving = page.waitForRequest(isSave);
    await page.keyboard.press("Control+Enter");
    expect((await saving).postDataJSON()).toMatchObject({ text: "how does the scheduler do preemption" });
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused({ timeout: AFTER_SUBMIT });
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Find people" })).toBeFocused();
  });

  test("the counter shows how many people are looking, as the server counts them", async ({ page }) => {
    const res = await page.request.get("/api/looking-for-me", { headers: { "x-demo-user": "p_003" } });
    expect(res.ok()).toBe(true);
    const { count } = await res.json();
    await open(page);
    const banner = page.getByTestId("looking-for-you");
    await expect(banner).toBeVisible();
    if (count === 0) await expect(banner).toContainText("No one is asking for someone like you yet");
    else await expect(banner).toContainText(`${count.toLocaleString("en-US")} ${count === 1 ? "person" : "people"} here`);
  });

  test("the counter words one and many", async ({ page }) => {
    let count = 1;
    await page.route("**/api/looking-for-me", (route) => route.fulfill({ json: { count } }));
    await open(page);
    await expect(page.getByTestId("looking-for-you")).toHaveText("1 person here is looking for someone like you");
    count = 12;
    await page.reload();
    await expect(page.getByTestId("looking-for-you")).toHaveText("12 people here are looking for someone like you");
  });

  test("a failed counter says so with Try again, never zero", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/looking-for-me", (route) => {
      calls++;
      return calls === 1 ? route.fulfill({ status: 503, json: { error: "Search unavailable" } }) : route.fulfill({ json: { count: 4 } });
    });
    await open(page);
    await expect(page.getByText("Couldn't load who's looking for you.")).toBeVisible();
    await expect(page.getByTestId("looking-for-you")).toHaveCount(0);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("looking-for-you")).toContainText("4 people here");
  });

  test("the header leads back to your profile", async ({ page }) => {
    await open(page);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const scan = async (label: string) =>
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, label).toEqual([]);
      await open(page);
      await expect(page.getByTestId("looking-for-you")).toBeVisible();
      await send(page).click();
      await expect(page.getByText("Write a few words about what you want to ask.")).toBeVisible();
      await scan("empty with a problem");
      await box(page).fill("how does Raft do the voting thing");
      await sharpen(page).click();
      await expect(page.getByText("Sharpened with AI.")).toBeVisible();
      await scan("sharpened suggestion");
      await send(page).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Current request");
      await scan("sent");
    });
  }
});
