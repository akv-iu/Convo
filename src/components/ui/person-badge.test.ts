import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchDetails } from "@/app/(app)/matches/match-card";
import { Badge } from "@/app/(onboarding)/_components/badge";
import type { CardPerson } from "@/contracts/types";
import { MatchSummary } from "./match-summary";
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

describe("people without GitHub", () => {
  // Google-only accounts have no handle. The cast compiles both before and after the contract allows null.
  const noGitHub: CardPerson = { ...person, githubLogin: null as unknown as CardPerson["githubLogin"] };
  const match = { person: noGitHub, explanation: "Works on Rust", mutual: false, highlights: [], badges: [], score: 1, rank: 0 };

  it("shows no handle and no GitHub link on cards, rows and match details", () => {
    for (const html of [
      renderToStaticMarkup(createElement(PersonBadge, { person: noGitHub })),
      renderToStaticMarkup(createElement(MatchDetails, { match, nameId: "n" })),
    ]) {
      expect(html).not.toContain("href=");
      expect(html).not.toContain("GitHub");
    }
    expect(renderToStaticMarkup(createElement(MatchSummary, { match }))).not.toContain("@");
  });

  it("leaves the onboarding badge's handle line out, keeping the placeholder only while unknown", () => {
    expect(renderToStaticMarkup(createElement(Badge, { name: "Ada", handle: null }))).not.toContain("@");
    expect(renderToStaticMarkup(createElement(Badge, { name: "Ada" }))).toContain("@your-github");
  });
});
