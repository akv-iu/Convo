import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { IncomingMessage, RequestOptions } from "node:http";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EnrichmentDiscovery } from "@/contracts/enrichment";
import type { RouteBody } from "@/contracts/routes";

// The network boundary: DNS answers and HTTPS replies are recorded; nothing leaves the machine.
vi.mock("node:dns", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));
const { lookup } = await import("node:dns");
const { request } = await import("node:https");
const { collectPublicProfile, findPublicProfilePages } = await import("./public-profile");
const { isPublicAddress, publicLookup, safeUrl } = await import("./safe-fetch");

const fixture = (name: string) => readFileSync(new URL(`./fixtures/public-profile/${name}`, import.meta.url), "utf8");
const key = "recorded-brave-key";
const owner = "google:101";
const lookupBody: RouteBody<"discoverEnrichment"> = { source: "public_profile", name: "Ada Example", workplaceName: "Example University", rorId: null, orcid: null };
const PROFILE = "https://people.uni.example/staff/ada";

type Reply = { status?: number; headers?: Record<string, string>; body?: string | Buffer | (() => AsyncGenerator<Buffer>); error?: Error };
let dns: Map<string, string[] | (() => string[])>;
let sites: Map<string, Reply>;
let served: string[];
let opened: { url: string; options: RequestOptions }[];

beforeEach(() => {
  dns = new Map([["people.uni.example", ["198.51.99.10"]], ["www.uni.example", ["2a00:1450::10"]]]);
  sites = new Map([
    ["https://people.uni.example/robots.txt", { status: 404 }],
    [PROFILE, { headers: { "content-type": "text/html; charset=utf-8" }, body: fixture("profile-page.html") }],
  ]);
  served = [];
  opened = [];
  vi.mocked(lookup).mockImplementation(((host: string, _options: unknown, callback: (e: Error | null, a: unknown) => void) => {
    const entry = dns.get(host);
    const addresses = typeof entry === "function" ? entry() : entry;
    if (!addresses) return callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" }), []);
    callback(null, addresses.map((address) => ({ address, family: isIP(address) })));
  }) as unknown as typeof lookup);
  vi.mocked(request).mockImplementation(((url: URL, options: RequestOptions, onResponse: (res: IncomingMessage) => void) => {
    const req = Object.assign(new EventEmitter(), { destroy: () => req });
    Object.assign(req, {
      end: () => {
        opened.push({ url: url.href, options });
        // Connect the way Node does: through the caller's lookup hook, else plain unchecked DNS.
        const plain: LookupFunction = (host, _options, callback) =>
          lookup(host, { all: true }, (error, addresses) => callback(error, addresses));
        ((options.lookup as LookupFunction | undefined) ?? plain)(url.hostname, { all: true }, (error) => {
          if (error) return void req.emit("error", error);
          const reply = sites.get(url.href) ?? { status: 404 };
          if (reply.error) return void req.emit("error", reply.error);
          served.push(url.href);
          const body = reply.body ?? "";
          const res = (typeof body === "function" ? Readable.from(body()) : Readable.from([Buffer.from(body)])) as IncomingMessage;
          res.statusCode = reply.status ?? 200;
          res.headers = reply.headers ?? {};
          onResponse(res);
        });
      },
    });
    return req;
  }) as unknown as typeof request);
});
const fetcher = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const brave = () => JSON.parse(fixture("brave-search.json"));
const fails = (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code, message: "Profile enrichment could not complete." });

// ---- Discovery ----

it("suggests at most four deduplicated HTTPS pages in plain text, with the visible hostname, none selected", async () => {
  fetcher.mockResolvedValueOnce(json(brave()));
  const found = await findPublicProfilePages(lookupBody, key);
  expect(found.map((c) => c.url)).toEqual([
    "https://blog.ada.example/about/", "https://people.uni.example/staff/ada-example", "https://conf.example/speakers/ada",
    "https://group.example/members/ada",
  ]);
  expect(found[0]).toMatchObject({ title: "Ada Example & the Systems Lab", domain: "blog.ada.example",
    snippet: "Personal site of Ada Example, who writes about reliable systems." });
  expect(new Set(found.map((c) => c.id)).size).toBe(4);
  // The whole discovery reply the route will build still satisfies the contract.
  EnrichmentDiscovery.parse({ source: "public_profile", discoveryId: "d1", status: "ok", expiresAt: new Date().toISOString(), candidates: found });

  const [url, init] = fetcher.mock.calls[0];
  const sent = new URL(String(url));
  expect(sent.origin + sent.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
  expect(sent.searchParams.get("q")).toBe('"Ada Example" Example University');
  expect(String(url)).not.toContain(key);
  expect(init).toMatchObject({ redirect: "error", cache: "no-store", headers: { "X-Subscription-Token": key } });
  expect(request).not.toHaveBeenCalled(); // discovery never opens a suggested page
});

it("prefers pages on the confirmed organisation's ROR domain, and a ROR failure only loses that preference", async () => {
  const withRor = { ...lookupBody, rorId: "https://ror.org/03yrm5c26" };
  fetcher.mockResolvedValueOnce(json(JSON.parse(fixture("ror-organization.json")))).mockResolvedValueOnce(json(brave()));
  const ranked = await findPublicProfilePages(withRor, key);
  expect(ranked[0].domain).toBe("people.uni.example");
  expect(String(fetcher.mock.calls[0][0])).toBe("https://api.ror.org/v2/organizations/03yrm5c26");

  fetcher.mockResolvedValueOnce(new Response("down", { status: 500 })).mockResolvedValueOnce(json(brave()));
  expect((await findPublicProfilePages(withRor, key))[0].domain).toBe("blog.ada.example");
});

it("quotes only the name, and searches without a workplace when there is none", async () => {
  fetcher.mockResolvedValueOnce(json({ web: { results: [] } }));
  expect(await findPublicProfilePages({ ...lookupBody, name: 'Ada "x" Example', workplaceName: null }, key)).toEqual([]);
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("q")).toBe('"Ada  x  Example"');
  fetcher.mockResolvedValueOnce(json({ type: "search" }));
  expect(await findPublicProfilePages(lookupBody, key)).toEqual([]);
});

it("reports search failures as sanitized, retryable outcomes", async () => {
  await fails(findPublicProfilePages(lookupBody, " "), "provider_down");
  expect(fetcher).not.toHaveBeenCalled();
  await fails(findPublicProfilePages({ ...lookupBody, source: "research" }, key), "invalid_input");

  fetcher.mockResolvedValueOnce(json({ message: "quota" }, 429, { "X-RateLimit-Remaining": "5, 0", "X-RateLimit-Reset": "1, 3600" }));
  await expect(findPublicProfilePages(lookupBody, key)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 3600 });
  fetcher.mockResolvedValueOnce(json({}, 429, { "Retry-After": "7" }));
  await expect(findPublicProfilePages(lookupBody, key)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 7 });
  fetcher.mockResolvedValueOnce(json({}, 429));
  await expect(findPublicProfilePages(lookupBody, key)).rejects.toMatchObject({ retryAfterSeconds: 60 });
  fetcher.mockResolvedValueOnce(json({ secret: "provider body" }, 401));
  await fails(findPublicProfilePages(lookupBody, key), "provider_down");
  fetcher.mockResolvedValueOnce(json({ web: { results: "not a list" } }));
  await fails(findPublicProfilePages(lookupBody, key), "provider_down");
  fetcher.mockRejectedValueOnce(Object.assign(new Error(`timed out with ${key}`), { name: "TimeoutError" }));
  await fails(findPublicProfilePages(lookupBody, key), "timeout");
  fetcher.mockRejectedValueOnce(new Error(`fetch failed for ${key}`));
  await fails(findPublicProfilePages(lookupBody, key), "provider_down");
});

// ---- The confirmed page ----

it("reads only the confirmed page, after its robots.txt, as bounded plain-text evidence", async () => {
  const evidence = await collectPublicProfile(owner, { url: PROFILE });
  expect(evidence).toMatchObject({
    id: `${owner}:profile_page:public-page`, personId: owner, sourceId: `${owner}:public_profile`,
    source: "public_profile", kind: "profile_page", title: "Prof. Ada Example – Computer Science", url: PROFILE,
  });
  expect(evidence.excerpt).toMatch(/^Ada Example\nProfessor of Computer Science/);
  expect(evidence.excerpt).not.toMatch(/MUST NOT APPEAR/);
  expect(served).toEqual(["https://people.uni.example/robots.txt", PROFILE]);
  expect(fetcher).not.toHaveBeenCalled(); // no search, so no snippet can become evidence
  for (const { options } of opened) {
    expect(options).toMatchObject({ agent: false, lookup: publicLookup, method: "GET" });
    expect(options.headers).not.toHaveProperty("Cookie");
  }

  const long = `<main><p>${"word ".repeat(2000)}</p></main>`;
  sites.set(PROFILE, { headers: { "content-type": "text/html" }, body: long });
  expect((await collectPublicProfile(owner, { url: PROFILE })).excerpt).toHaveLength(3000);
});

it("uses pasted text as neutral Profile text evidence with no URL", async () => {
  const evidence = await collectPublicProfile(owner, { kind: "text", text: "  Leads the systems lab.\u0000\r\n\r\nWrites about proofs.  " });
  expect(evidence).toEqual({
    id: `${owner}:profile_page:public-text`, personId: owner, sourceId: `${owner}:public_profile`, source: "public_profile",
    kind: "profile_page", title: "Profile text", excerpt: "Leads the systems lab.\nWrites about proofs.", retrievedAt: expect.any(String),
  });
  expect(evidence).not.toHaveProperty("url");
  expect((await collectPublicProfile(owner, { kind: "text", text: "x ".repeat(5000) })).excerpt.length).toBeLessThanOrEqual(3000);
  await fails(collectPublicProfile(owner, { kind: "text", text: " \u0000 " }), "invalid_input");
  await fails(collectPublicProfile(owner, { kind: "text", text: "x".repeat(30_001) }), "invalid_input");
  expect(request).not.toHaveBeenCalled();
});

it("refuses private, loopback, link-local, mapped and mixed DNS answers when connecting", async () => {
  for (const addresses of [["10.0.0.5"], ["127.0.0.1"], ["169.254.169.254"], ["100.100.100.200"], ["::1"], ["fd00:ec2::254"],
    ["::ffff:127.0.0.1"], ["64:ff9b::a00:1"], ["198.51.99.10", "192.168.1.1"]]) {
    dns.set("people.uni.example", addresses);
    served = [];
    await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");
    expect(served).toEqual([]);
  }
});

it("checks DNS again on every connection, so a rebinding answer is refused", async () => {
  let answers = 0;
  dns.set("people.uni.example", () => (answers++ === 0 ? ["198.51.99.10"] : ["127.0.0.1"]));
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");
  expect(served).toEqual(["https://people.uni.example/robots.txt"]); // the second connection never reached the page
  expect(answers).toBe(2);
});

it("follows at most three checked redirects and refuses unsafe ones", async () => {
  const redirect = (to: string): Reply => ({ status: 302, headers: { location: to } });
  for (const unsafe of ["http://people.uni.example/ada", "https://127.0.0.1/ada", "https://[::1]/ada", "https://user:pw@people.uni.example/",
    "https://people.uni.example:8443/ada", "https://localhost/ada", "https://intranet/ada"]) {
    sites.set(PROFILE, redirect(unsafe));
    served = [];
    await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");
    expect(served).toEqual(["https://people.uni.example/robots.txt", PROFILE]);
  }

  dns.set("evil.example", ["10.1.2.3"]);
  sites.set(PROFILE, redirect("https://evil.example/ada"));
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");

  // Three hops are followed; a fourth is refused even though a real page waits at its end.
  for (let i = 0; i < 4; i++) sites.set(`${PROFILE}/${i}`, redirect(`/staff/ada/${i + 1}`));
  sites.set(`${PROFILE}/4`, { headers: { "content-type": "text/html" }, body: "<p>End of a long chain.</p>" });
  sites.set(PROFILE, redirect("/staff/ada/2"));
  expect((await collectPublicProfile(owner, { url: PROFILE })).excerpt).toBe("End of a long chain.");
  sites.set(PROFILE, redirect("/staff/ada/1"));
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");

  // A safe move to another site is followed, and that site's robots.txt applies too.
  dns.set("new.uni.example", ["198.51.99.11"]);
  sites.set(PROFILE, redirect("https://new.uni.example/ada#bio"));
  sites.set("https://new.uni.example/ada", { headers: { "content-type": "text/html" }, body: "<title>New</title><p>Moved bio text.</p>" });
  sites.set("https://new.uni.example/robots.txt", { headers: { "content-type": "text/plain" }, body: "User-agent: *\nAllow: /" });
  expect(await collectPublicProfile(owner, { url: PROFILE })).toMatchObject({ url: PROFILE, excerpt: "Moved bio text." });
  sites.set("https://new.uni.example/robots.txt", { headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /ada" });
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_blocked");
});

it("checks robots.txt for every redirect target before requesting it", async () => {
  const redirect = (to: string): Reply => ({ status: 302, headers: { location: to } });
  const robots = (rules: string): Reply => ({ headers: { "content-type": "text/plain" }, body: `User-agent: *\n${rules}` });

  // The same site: the page moves into a path its robots.txt disallows.
  sites.set("https://people.uni.example/robots.txt", robots("Disallow: /private/"));
  sites.set(PROFILE, redirect("/private/ada"));
  sites.set("https://people.uni.example/private/ada", { headers: { "content-type": "text/html" }, body: "<p>Not for crawlers.</p>" });
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_blocked");
  expect(served).toEqual(["https://people.uni.example/robots.txt", PROFILE]);

  // Another site: its robots.txt is read before the moved page is requested.
  served = [];
  dns.set("new.uni.example", ["198.51.99.11"]);
  sites.set(PROFILE, redirect("https://new.uni.example/ada"));
  sites.set("https://new.uni.example/robots.txt", robots("Disallow: /ada"));
  sites.set("https://new.uni.example/ada", { headers: { "content-type": "text/html" }, body: "<p>Not for crawlers.</p>" });
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_blocked");
  expect(served).toEqual(["https://people.uni.example/robots.txt", PROFILE, "https://new.uni.example/robots.txt"]);
});

it("stops oversized, wrongly typed and undecodable bodies", async () => {
  sites.set(PROFILE, { headers: { "content-type": "text/html", "content-length": String(2 * 1024 * 1024) }, body: "<p>x</p>" });
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");

  let chunks = 0;
  async function* endless() {
    for (;;) {
      chunks++;
      yield Buffer.alloc(64 * 1024, 120);
    }
  }
  sites.set(PROFILE, { headers: { "content-type": "text/html" }, body: endless });
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");
  expect(chunks).toBeLessThan(20); // stopped just past 1 MiB, not read to the end

  // A decompression bomb: a few KiB that would decode to 8 MiB of readable text.
  const bomb = gzipSync(`<p>${"bio ".repeat(2 * 1024 * 1024)}</p>`);
  expect(bomb.length).toBeLessThan(64 * 1024);
  sites.set(PROFILE, { headers: { "content-type": "text/html", "content-encoding": "gzip" }, body: bomb });
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");
  // The opposite: over 1 MiB on the wire (empty gzip members) that decodes to a few bytes.
  const padded = Buffer.concat([gzipSync("<p>Bio</p>"), ...Array.from({ length: 60_000 }, () => gzipSync(""))]);
  expect(padded.length).toBeGreaterThan(1024 * 1024);
  sites.set(PROFILE, { headers: { "content-type": "text/html", "content-encoding": "gzip" }, body: padded });
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");

  sites.set(PROFILE, { headers: { "content-type": "text/html", "content-encoding": "gzip" }, body: gzipSync("<p>Compressed bio.</p>") });
  expect((await collectPublicProfile(owner, { url: PROFILE })).excerpt).toBe("Compressed bio.");

  for (const headers of <Record<string, string>[]>[{ "content-type": "application/pdf" }, { "content-type": "image/png" }, {}, { "content-type": "text/html", "content-encoding": "zstd" }]) {
    sites.set(PROFILE, { headers, body: "%PDF-1.4" });
    await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");
  }

  sites.set(PROFILE, { headers: { "content-type": "text/plain; charset=utf-8" }, body: "Plain profile.\n\nSecond line." });
  expect(await collectPublicProfile(owner, { url: PROFILE })).toMatchObject({ title: "people.uni.example", excerpt: "Plain profile.\nSecond line." });
});

it("respects access restrictions: login, refusal, robots rules and directives", async () => {
  const blocked = async () => fails(collectPublicProfile(owner, { url: PROFILE }), "page_blocked");
  for (const status of [401, 403, 451]) {
    sites.set(PROFILE, { status, body: "Sign in" });
    await blocked();
  }
  sites.set(PROFILE, { headers: { "content-type": "text/html" }, body: '<form><input type="password"></form><p>Members only</p>' });
  await blocked();
  sites.set(PROFILE, { headers: { "content-type": "text/html" }, body: '<meta name="robots" content="noindex"><p>Bio</p>' });
  await blocked();
  sites.set(PROFILE, { headers: { "content-type": "text/html", "x-robots-tag": "none" }, body: "<p>Bio</p>" });
  await blocked();

  sites.set(PROFILE, { headers: { "content-type": "text/html" }, body: "<p>Bio</p>" });
  sites.set("https://people.uni.example/robots.txt", { headers: { "content-type": "text/plain" }, body: "User-agent: Lanyard\nDisallow: /staff/" });
  served = [];
  await blocked();
  expect(served).toEqual(["https://people.uni.example/robots.txt"]); // the page itself was never requested

  sites.set("https://people.uni.example/robots.txt", { status: 503 });
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable"); // RFC 9309: no answer means not now
  sites.set("https://people.uni.example/robots.txt", { status: 403 });
  expect((await collectPublicProfile(owner, { url: PROFILE })).excerpt).toBe("Bio"); // 4xx: no rules
});

it("reports unavailable, empty, rate-limited and timed-out pages without the provider's text", async () => {
  for (const status of [404, 410, 500, 204, 304]) {
    sites.set(PROFILE, { status, body: `secret ${PROFILE}` });
    await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");
  }
  sites.set(PROFILE, { status: 429, headers: { "retry-after": "120" } });
  await expect(collectPublicProfile(owner, { url: PROFILE })).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 120 });
  sites.set(PROFILE, { headers: { "content-type": "text/html" }, body: "<script>only()</script><nav>Menu</nav>" });
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");
  sites.set(PROFILE, { error: Object.assign(new Error(`The operation was aborted for ${PROFILE}`), { name: "AbortError" }) });
  await fails(collectPublicProfile(owner, { url: PROFILE }), "timeout");
  sites.set(PROFILE, { error: Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" }) });
  await fails(collectPublicProfile(owner, { url: PROFILE }), "page_unavailable");
  dns.delete("people.uni.example");
  const failure = await collectPublicProfile(owner, { url: PROFILE }).catch((e: unknown) => e);
  expect(failure).toMatchObject({ code: "page_unavailable" });
  expect(JSON.stringify(failure) + String(failure)).not.toMatch(/people\.uni|ENOTFOUND|secret/);
  for (const url of ["http://people.uni.example/ada", "https://10.0.0.1/", "not a url"]) {
    await fails(collectPublicProfile(owner, { url }), "page_unavailable");
  }
});

// ---- Address and URL rules ----

it("accepts only public internet addresses", () => {
  for (const address of ["8.8.8.8", "198.51.99.10", "2a00:1450::10", "2606:4700::1111"]) expect(isPublicAddress(address)).toBe(true);
  for (const address of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.0.0.1", "192.0.2.1",
    "192.168.0.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:8.8.8.8",
    "64:ff9b::808:808", "fc00::1", "fe80::1", "ff02::1", "2001::1", "2001:db8::1", "2002:c000:0204::1", "not-an-ip"]) {
    expect(isPublicAddress(address), address).toBe(false);
  }
});

it("lets only HTTPS URLs on the default port with ordinary hostnames through", () => {
  expect(safeUrl("https://people.uni.example/staff/ada#bio")?.href).toBe("https://people.uni.example/staff/ada");
  expect(safeUrl("/next", new URL("https://people.uni.example/a"))?.href).toBe("https://people.uni.example/next");
  expect(safeUrl("https://people.uni.example:443/a")?.href).toBe("https://people.uni.example/a");
  for (const url of ["http://a.example/", "https://a.example:444/", "https://u:p@a.example/", "https://127.1/", "https://0x7f000001/",
    "https://[::1]/", "https://localhost/", "https://printer.local/", "https://box.internal/", "https://intranet/", "ftp://a.example/",
    `https://a.example/${"x".repeat(2100)}`, "::"]) {
    expect(safeUrl(url), url).toBeNull();
  }
});

it("passes only public answers to the connection, in the shape Node asks for", async () => {
  dns.set("pair.example", ["198.51.99.10", "2a00:1450::10"]);
  const one = await new Promise<unknown[]>((resolve) => publicLookup("pair.example", { family: 6 }, (...args) => resolve(args)));
  expect(one).toEqual([null, "2a00:1450::10", 6]);
  const all = await new Promise<unknown[]>((resolve) => publicLookup("pair.example", { all: true }, (...args) => resolve(args)));
  expect(all[1]).toHaveLength(2);
  const none = await new Promise<unknown[]>((resolve) => publicLookup("missing.example", {}, (...args) => resolve(args)));
  expect(none[0]).toBeInstanceOf(Error);
});
