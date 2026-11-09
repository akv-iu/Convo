import { describe, expect, it } from "vitest";
import { approvedByOther, checklist, completes, screenOnly, verdict } from "./feature-signoff.mjs";

describe("feature sign-off", () => {
  it("counts ticked and open boxes, nested or not, and nothing else in brackets", () => {
    expect(checklist("- [x] Screen\n- [ ] Tests\n  * [X] Nested\n- [ ]\nsee [ ] and [x] in a sentence")).toEqual({ done: 2, open: 2 });
    expect(checklist("# No checklist")).toEqual({ done: 0, open: 0 });
  });

  it("treats a PR as screen-only only when every changed file is a screen file", () => {
    const file = (filename, previous_filename) => ({ filename, previous_filename });
    expect(screenOnly([
      file("src/app/(app)/ask/ask-form.tsx"), file("src/app/(onboarding)/onboarding/badge-form.tsx"), file("src/app/page.tsx"),
      file("src/components/ui/logo.tsx"), file("tests/e2e/ask.spec.ts"), file("public/icon.png"), file("docs/features/thing.md"),
    ])).toBe(true);
    for (const other of ["src/contracts/types.ts", "src/server/real.ts", "src/app/api/asks/route.ts", "db/schema/index.ts",
      ".github/workflows/ci.yml", "AGENTS.md", "src/app/layout.tsx", "package.json", "src/app/(app)/../api/x.ts"]) {
      expect(screenOnly([file("src/components/ui/logo.tsx"), file(other)]), other).toBe(false);
    }
    expect(screenOnly([file("src/components/ui/moved.tsx", "src/server/old.ts")])).toBe(false); // moved out of the backend
    expect(screenOnly([])).toBe(false);
  });

  it("needs sign-off only from the PR that ticks the last box", () => {
    const done = "- [x] Screen\n- [x] Tests";
    const half = "- [x] Screen\n- [ ] Tests";
    expect(completes(done, half)).toBe(true); // ticks the last box
    expect(completes(done, null)).toBe(true); // a new feature finished in one PR
    expect(completes(half, null)).toBe(false); // still in progress
    expect(completes(done, done)).toBe(false); // already complete on main: a later edit doesn't need it again
    expect(completes("# No checklist yet", null)).toBe(false);
  });

  it("needs the latest verdict of someone other than the author to be an approval", () => {
    const review = (login, state, type = "User") => ({ user: { login, type }, state });
    expect(approvedByOther([review("b", "APPROVED")], "a")).toBe(true);
    expect(approvedByOther([review("a", "APPROVED")], "a")).toBe(false); // the author's own
    expect(approvedByOther([review("gitar-bot", "APPROVED", "Bot")], "a")).toBe(false);
    expect(approvedByOther([review("b", "APPROVED"), review("b", "COMMENTED")], "a")).toBe(true);
    expect(approvedByOther([review("b", "APPROVED"), review("b", "CHANGES_REQUESTED")], "a")).toBe(false);
    expect(approvedByOther([review("b", "APPROVED"), review("b", "DISMISSED")], "a")).toBe(false);
    expect(approvedByOther([], "a")).toBe(false);
  });

  it("fails only when something needs sign-off and nobody else has approved", () => {
    expect(verdict([], false).state).toBe("success");
    expect(verdict(["the needs-approval label"], false)).toEqual({
      state: "failure",
      description: "Waiting for the other person's approval: the needs-approval label.",
    });
    expect(verdict(["the needs-approval label"], true).state).toBe("success");
  });
});
