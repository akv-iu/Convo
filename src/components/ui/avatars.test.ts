import { describe, expect, it } from "vitest";
import { AvatarId } from "@/contracts/types";
import { avatars, initials } from "./avatars";

describe("initials", () => {
  it("takes the first and last words' first letters, upper-cased", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("  grace   brewster murray hopper ")).toBe("GH");
    expect(initials("Cher")).toBe("C");
    expect(initials("Łukasz Ślązak")).toBe("ŁŚ");
    expect(initials("   ")).toBe("?");
  });
});

describe("avatars", () => {
  it("has art for exactly the contract's pictures, each with a name", () => {
    expect(avatars.map((a) => a.id)).toEqual(AvatarId.options);
    expect(avatars.every((a) => a.name.length > 0 && a.art)).toBe(true);
  });
});
