import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Step 1's server action: what it stores and where it sends the user.
 * Next's cookie store, redirect and Auth.js sign-in are replaced with
 * stand-ins that record what happened; nothing talks to GitHub.
 */

const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
const signIn = vi.fn();
const fakeApi = { value: true };

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => jar.set(name, { value, options }),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("@/server/auth", () => ({ signIn: (...args: unknown[]) => signIn(...args) }));
vi.mock("@/server/config", () => ({
  config: {
    get fakeApi() {
      return fakeApi.value;
    },
  },
}));

const { continueWithGitHub } = await import("./actions");

/** The step 1 form as the browser posts it: github=on plus one consent=<id> per ticked source. */
function form(github: boolean, consent: string[] = []) {
  const data = new FormData();
  if (github) data.set("github", "on");
  for (const id of consent) data.append("consent", id);
  return data;
}

async function redirectOf(run: Promise<unknown>) {
  try {
    await run;
  } catch (e) {
    if (e instanceof Redirect) return e.to;
    throw e;
  }
  return null;
}

describe("continueWithGitHub (step 1)", () => {
  beforeEach(() => {
    jar.clear();
    signIn.mockReset();
    fakeApi.value = true;
  });

  it("with every source ticked, saves consent for all three and goes to step 2 on the fake API", async () => {
    expect(await redirectOf(continueWithGitHub(form(true, ["profile", "repos", "orgs"])))).toBe("/onboarding");
    const consent = jar.get("convo_consent");
    expect(consent?.value).toBe("profile,repos,orgs");
    expect(consent?.options).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7 });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("saves only the sources left ticked, in B2's order", async () => {
    await redirectOf(continueWithGitHub(form(true, ["orgs", "profile"])));
    expect(jar.get("convo_consent")?.value).toBe("profile,orgs");
  });

  it("with every source unticked, saves an empty value (basic identity only)", async () => {
    expect(await redirectOf(continueWithGitHub(form(true)))).toBe("/onboarding");
    expect(jar.get("convo_consent")?.value).toBe("");
  });

  it("ignores IDs that aren't GitHub sources", async () => {
    await redirectOf(continueWithGitHub(form(true, ["repos", "email", "papers"])));
    expect(jar.get("convo_consent")?.value).toBe("repos");
  });

  it("with GitHub off, stores nothing and returns to step 1", async () => {
    expect(await redirectOf(continueWithGitHub(form(false, ["repos"])))).toBe("/signin");
    expect(jar.size).toBe(0);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("on the real API, starts GitHub sign-in that comes back to step 2", async () => {
    fakeApi.value = false;
    expect(await redirectOf(continueWithGitHub(form(true, ["repos"])))).toBeNull();
    expect(jar.get("convo_consent")?.value).toBe("repos");
    expect(signIn).toHaveBeenCalledWith("github", { redirectTo: "/onboarding" });
  });
});
