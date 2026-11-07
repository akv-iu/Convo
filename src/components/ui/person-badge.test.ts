import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CardPerson } from "@/contracts/types";
import { PersonBadge } from "./person-badge";

const person: CardPerson = {
  id: "p", name: "Ada <script>", githubLogin: "a/b?c", bio: "<img src=x>",
  filters: { country: null, rorId: null, hiring: null }, workplaceName: null,
  languages: ["Rust"], organisations: [], freeTimes: [], synthetic: true,
};

describe("shared person badge", () => {
  it("keeps the match heading, escapes public text and leaves hidden facts out", () => {
    const html = renderToStaticMarkup(createElement(PersonBadge, { person, nameId: "person-name" }));
    expect(html).toContain('<h2 id="person-name"');
    expect(html).toContain("Ada &lt;script&gt;");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toContain('href="https://github.com/a%2Fb%3Fc"');
    expect(html).toContain("Synthetic profile");
    expect(html).toContain("Rust");
    expect(html).not.toContain("Not hiring");
  });

  it("shows an honest placeholder for a missing request profile", () => {
    const html = renderToStaticMarkup(createElement(PersonBadge, { person: null, caption: "Sent to" }));
    expect(html).toContain("Sent to");
    expect(html).toContain("someone at the conference");
    expect(html).not.toContain("href=");
  });
});
