import { describe, expect, it } from "vitest";
import { AvatarId } from "@/contracts/types";
import { avatars, faces, initials, shapes } from "./avatars";

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
    expect([...avatars.map((a) => a.id)].sort()).toEqual([...AvatarId.options].sort());
    expect(shapes.every((a) => a.name.length > 0 && a.art)).toBe(true);
    expect(faces).toHaveLength(10);
    expect(faces.every((a) => a.id.startsWith("face-") && a.person.avatar === a.id)).toBe(true);
  });
});
