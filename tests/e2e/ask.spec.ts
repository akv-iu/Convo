import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * A1 step 5: the ask box and refine screen, on the fake API (canned AI:
 * deterministic, free, and "idiot" stands in for a moderation block).
 */

const AFTER_SUBMIT = 15_000;

const box = (page: Page) => page.getByRole("textbox", { name: "What do you want to ask?" });
const sharpen = (page: Page) => page.getByRole("button", { name: "Sharpen my question" });
const isRefine = (req: Request) => req.url().endsWith("/api/refine") && req.method() === "POST";
const alertWithText = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

async function open(page: Page, person = "p_003") {
  await page.setExtraHTTPHeaders({ "x-demo-user": person });
  await page.goto("/ask");
  await expect(box(page)).toBeVisible();
}

test.describe("ask and refine (A1 step 5)", () => {
  test("a rough ask comes back sharper, with its type and length, and is saved", async ({ page }) => {
    await open(page);
    await box(page).fill("how does Raft do the voting thing");
    const sent = page.waitForRequest(isRefine);
    await sharpen(page).click();
    expect((await sent).postDataJSON()).toEqual({ text: "how does Raft do the voting thing" });

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Here's your question");
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page.locator("blockquote")).toContainText("how does Raft do the voting thing:");
    await expect(page.getByText("Learn something")).toBeVisible();
    await expect(page.getByText("10-minute chat")).toBeVisible();
    await expect(page.getByText("You wrote:")).toBeVisible();

    const href = await page.getByRole("link", { name: "Find people" }).getAttribute("href");
    const askId = new URL(href!, "http://x").searchParams.get("ask");
    expect(askId).toBeTruthy();
    // The server saved it: matching that ask works for its owner.
    const match = await page.request.post("/api/match", { headers: { "x-demo-user": "p_003" }, data: { askId } });
    expect(match.ok()).toBe(true);
  });

  test("a career ask is labelled as one, with a longer chat", async ({ page }) => {
    await open(page);
    await box(page).fill("I want a job at Stripe");
    await sharpen(page).click();
    await expect(page.getByText("Career move")).toBeVisible({ timeout: AFTER_SUBMIT });
    await expect(page.getByText("15-minute chat")).toBeVisible();
  });

  test("too short is explained and nothing is sent", async ({ page }) => {
    await open(page);
    let sent = false;
    page.on("request", (r) => {
      if (isRefine(r)) sent = true;
    });
    await box(page).fill("hi");
    await sharpen(page).click();
    await expect(page.getByText("Write a few words about what you want to ask.")).toBeVisible();
    await expect(box(page)).toBeFocused();
    expect(sent).toBe(false);
  });

  test("a blocked ask shows the reason, keeps the text, and nothing is saved", async ({ page }) => {
    await open(page);
    await box(page).fill("why is my manager such an idiot");
    await sharpen(page).click();
    await expect(alertWithText(page)).toContainText("looks offensive or unsafe");
    await expect(box(page)).toHaveValue("why is my manager such an idiot");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("What do you want to ask?");
  });

  test("a failed sharpen can be retried, and only one request is in flight", async ({ page }) => {
    await open(page);
    let calls = 0;
    await page.route("**/api/refine", async (route) => {
      calls++;
      if (calls === 1) {
        await new Promise((r) => setTimeout(r, 400));
        return route.fulfill({ status: 503, json: { error: "Lanyard is busy. Try again." } });
      }
      return route.fallback();
    });
    await box(page).fill("how does etcd store keys");
    await sharpen(page).click();
    await expect(page.getByRole("button", { name: "Sharpening…" })).toBeDisabled();
    await expect(alertWithText(page)).toHaveText("Lanyard is busy. Try again.");
    expect(calls).toBe(1);
    await sharpen(page).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Here's your question", { timeout: AFTER_SUBMIT });
    expect(calls).toBe(2);
  });

  test("an unfinished profile is sent to set up first", async ({ page }) => {
    await open(page);
    await page.route("**/api/refine", (route) => route.fulfill({ status: 409, json: { error: "Complete onboarding first." } }));
    await box(page).fill("how does etcd store keys");
    await sharpen(page).click();
    await expect(alertWithText(page)).toContainText("Finish setting up your badge first.");
    await expect(page.getByRole("link", { name: "Set up your badge" })).toHaveAttribute("href", "/signin");
  });

  test("Ask something else goes back with the text kept", async ({ page }) => {
    await open(page);
    await box(page).fill("how does Raft do the voting thing");
    await sharpen(page).click();
    await page.getByRole("button", { name: "Ask something else" }).click();
    await expect(box(page)).toBeFocused();
    await expect(box(page)).toHaveValue("how does Raft do the voting thing");
  });

  test("works with the keyboard alone, Ctrl+Enter sending", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard path is checked on the laptop project");
    await open(page);
    await page.keyboard.press("Tab"); // skip link
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await box(page).focus();
    await page.keyboard.type("how does the scheduler do preemption");
    await page.keyboard.press("Control+Enter");
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

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const scan = async (label: string) =>
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations, label).toEqual([]);
      await open(page);
      await expect(page.getByTestId("looking-for-you")).toBeVisible();
      await sharpen(page).click();
      await expect(page.getByText("Write a few words about what you want to ask.")).toBeVisible();
      await scan("empty with a problem");
      await box(page).fill("how does Raft do the voting thing");
      await sharpen(page).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Here's your question");
      await scan("refined");
    });
  }
});
