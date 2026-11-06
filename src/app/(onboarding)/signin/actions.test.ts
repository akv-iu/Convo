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

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
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

  it("with GitHub on, saves consent for all GitHub sources and goes to step 2 on the fake API", async () => {
    expect(await redirectOf(continueWithGitHub(form({ github: "on" })))).toBe("/onboarding");
    const consent = jar.get("convo_consent");
    expect(consent?.value).toBe("profile,repos,orgs");
    expect(consent?.options).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7 });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("with GitHub off, stores nothing and returns to step 1", async () => {
    expect(await redirectOf(continueWithGitHub(form({})))).toBe("/signin");
    expect(jar.size).toBe(0);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("on the real API, starts GitHub sign-in that comes back to step 2", async () => {
    fakeApi.value = false;
    expect(await redirectOf(continueWithGitHub(form({ github: "on" })))).toBeNull();
    expect(jar.get("convo_consent")?.value).toBe("profile,repos,orgs");
    expect(signIn).toHaveBeenCalledWith("github", { redirectTo: "/onboarding" });
  });
});
