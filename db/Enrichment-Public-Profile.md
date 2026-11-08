# Public-profile provider

Status: provider-only work on `b/enrichment-public-profile`, developed on `b/enrichment-github` `61032a3`. No route, configuration, environment value, job, storage, synthesis, approval, withdrawal, migration, contract, screen or package file changes. Configuration and route wiring stay with Codex. The eventual PR targets main after the foundation stack lands; Codex supplies the updated integration base.

## Interfaces

`src/server/profile/enrichment/public-profile.ts` exports:

- `findPublicProfilePages(input, apiKey)`: takes the agreed discovery body (`source:"public_profile"`) and the server-only Brave key; returns at most four candidates in the contract's shape: `{id, title, url, domain, snippet}`. Nothing is selected. The route builds the discovery wrapper (ID, status, expiry) and binds it to the owner and input.
- `collectPublicProfile(owner, choice)`: `choice` is the saved, confirmed `{url}` (a chosen candidate's URL or a typed URL) or `{kind:"text",text}`. Returns one evidence record, or throws a sanitized `StateError`. The future runner obtains the choice from the owner-bound saved selection and checks its lease; this function is not an authorization boundary.

Supporting files: `safe-fetch.ts` (the network boundary) and `page-text.ts` (pure parsing). Recorded fixtures are in `enrichment/fixtures/public-profile/`.

## Discovery

- Query: the name in quotes, then the typed workplace. One Brave Web Search request (`count=10`, strict safe search, no text decorations). The key goes only in the `X-Subscription-Token` header, never a URL. Fixed host, redirects refused, 1 MiB JSON limit (the shared `readProviderJson`).
- With a ROR ID, one keyless ROR request (3 s cap) supplies the organisation's domains; pages on those domains are listed first. A ROR failure only loses that ordering.
- Kept only: HTTPS on the default port, no credentials, an ordinary hostname (no IP literal, `localhost`, `.local`, `.internal` or single-label host), at most 2,048 characters. Dropped: login-walled sites this release doesn't import (LinkedIn, Facebook, Instagram, X/Twitter, TikTok) and file downloads (`.pdf`, `.doc(x)`, `.ppt(x)`, `.xls(x)`, `.zip`). Deduplicated by host without `www.`, path without trailing slash, and query. Fragments removed.
- Titles (≤200) and snippets (≤300) are plain text: tags, entities and control characters removed. `domain` is the URL's hostname, as the contract requires. IDs are a hash of the URL.
- Snippets are previews only: collection never searches or reads a snippet, so a snippet can't become evidence.
- Failures: 429 → `rate_limited` with Retry-After or Brave's exhausted-window reset (default 60 s); timeout → `timeout`; anything else, including a bad key or an unexpected reply → `provider_down`. No key → `provider_down` without a request.

## Reading the confirmed page

- One URL, no crawling: robots.txt for the page's site, then the page. Every redirect target is checked against its own site's robots.txt **before** it is requested, so a move into a disallowed path, on the same site or another, is never fetched. Each site's robots.txt is read once per run. No scripts run, no embedded assets (images, frames, styles) are fetched, and no cookies are sent.
- **Destinations.** HTTPS on port 443 only. The address check runs inside Node's connection lookup (`publicLookup`), so the connection goes to exactly the address that was checked; a later DNS answer can't be substituted (DNS rebinding). Every hop opens a new connection (`agent: false`) and is checked again. All of a hostname's answers must be public, so a mixed answer is refused. Refused: private, loopback, link-local (including 169.254.169.254 metadata), shared (100.64/10), benchmarking, documentation, multicast, reserved and broadcast IPv4; IPv6 outside global unicast (`2000::/3`), plus Teredo/IETF (`2001::/23`), documentation and 6to4. IPv4-mapped and NAT64 IPv6 forms are refused too. IP-literal hostnames skip DNS, so they are refused before connecting.
- **Redirects.** At most three, each re-checked as above, including the protocol (no downgrade to HTTP), port, credentials and hostname.
- **Limits.** One 10-second deadline per operation; the page body is limited to 1 MiB both on the wire and after decompression (gzip, deflate or br; any other encoding is refused). robots.txt is limited to 512 KiB. Accepted types: `text/html`, `application/xhtml+xml`, `text/plain`.
- **Access restrictions.** The page counts as blocked (`page_blocked`) if any of these apply:
  - It answers 401, 403, 407 or 451.
  - It contains a password field (a login wall).
  - robots.txt disallows it for `Lanyard` or `*` (RFC 9309: longest match wins, Allow wins a tie, `*` and `$` supported).
  - A robots meta tag (attribute values quoted or unquoted) or `X-Robots-Tag` says `noindex` or `none` for everyone or for Lanyard.

  Per RFC 9309, a robots.txt 4xx means there are no rules. A 5xx or no answer means "not now" (`page_unavailable`). Login walls are never bypassed.
- **Extraction.** Two passes. First, comments and non-content elements are removed: scripts, styles, templates, objects, frames, media, forms, navigation and asides. Void elements such as `<embed>` and `<img>` are dropped as tags. An unclosed raw-text element (script, style, textarea, title) hides the rest of the page, as in a browser; any other unclosed element drops only its tag. Then the `<main>` element (else `<article>`, else the body) is read. A `<main>` inside a comment or script can't be chosen, and the page header/footer is dropped only outside it. Entities are decoded and each block becomes a line. The charset comes from the header, else a `<meta>` tag, else UTF-8. The scanner uses `indexOf` and anchored or bounded patterns, so hostile markup stays linear.
- **Evidence.**
  - `id: <owner>:profile_page:public-page`, `source: public_profile`, `kind: profile_page`.
  - `title`: the page's og:title, else `<title>`, else the hostname.
  - `excerpt`: the first 3,000 characters of extracted text.
  - `url`: **the confirmed URL**, not a redirect target, which could carry session parameters.
  - Page text is untrusted data; instructions inside it are kept as text for synthesis to treat as data.
- **Failures.**
  - Unsafe destination or redirect, DNS/TLS/connection failure, 404/410/5xx, wrong type, oversized body, unknown encoding, too many redirects, or no text: `page_unavailable`.
  - 429: `rate_limited`, with Retry-After.
  - Deadline: `timeout`.

  Every error is the generic `StateError`: no URL, hostname, page text or provider message.

## Pasted text

`{kind:"text",text}` (at most 30,000 characters) becomes `id: <owner>:profile_page:public-text`, title **Profile text**, `kind: profile_page`, **no URL**. Control characters are removed and spaces collapsed, keeping line breaks; the excerpt is the first 3,000 characters. Empty or over-long text gives `invalid_input`. No network request is made.

## Limitations

- One evidence record per run (the agreed budget of one public page), so only the first 3,000 characters of a long page or paste are used.
- A password field anywhere on the page counts as a login wall, even a site-wide login box. The person can paste text instead.
- robots.txt patterns are compared with the URL's percent-encoded path; non-ASCII patterns written unencoded may not match.
- Named entities beyond a common set stay as written (`&foo;`). Numeric entities are always decoded.
- The Brave request and response fields follow Brave's documented Web Search API; they are checked here only against recorded replies. No live request was made.

## Verification

Recorded replies and a mocked network boundary only: `node:dns` and `node:https` are replaced, and the fake request connects through the lookup hook it receives (or plain DNS if none), as Node does. No live Brave, ROR or page requests, and no credentials.

```powershell
npx vitest run src/server/profile/enrichment/public-profile.test.ts src/server/profile/enrichment/page-text.test.ts
```

Each protection was also removed on purpose, and the tests failed every time. The protections checked this way:
- the connection-time lookup;
- the address rules;
- refusing mixed answers;
- the redirect limit;
- checking redirect targets;
- the wire-size and decoded-size limits;
- the robots check, including the check before each redirect hop;
- the login check.

## Deferred integration (Codex)

- Configuration: server-only `BRAVE_SEARCH_API_KEY`, read in `src/server/config.ts`, passed explicitly. Confirm Brave's display and retention terms for search results.
- The discovery route: reserve the discovery rate limit before calling Brave; build `{discoveryId, status, expiresAt}`; `no_matches` for an empty list, `unavailable` with the reason for a thrown error. Offer the typed-URL and paste fallbacks either way.
- The runner: pass the saved choice and owner. Map the thrown code to the source's progress reason. Check the lease and the consent generation before saving the evidence.

Before any live test, the user gets one complete checklist (setup, a test person with known public pages, blocked/unavailable/paste cases, cleanup) and is asked first.
