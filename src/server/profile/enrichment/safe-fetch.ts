/**
 * The public-profile fetcher's network boundary. One confirmed HTTPS URL is
 * read with no cookies, scripts or embedded assets.
 *
 * DNS rebinding: Node calls `publicLookup` while it opens each connection, and
 * connects to exactly the address that lookup approved. A check made earlier
 * can't be swapped out before connecting, and every redirect hop opens a new,
 * re-checked connection. Hostnames that are IP literals skip DNS, so they are
 * refused up front.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { pipeline, type Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export const USER_AGENT = "Lanyard/1.0 (profile import requested by the page's owner)";
const MAX_REDIRECTS = 3;

/** What went wrong, without the provider's text. The caller maps it to a contract reason. */
export type FetchFailure = "unsafe" | "unavailable" | "timeout" | "too_large" | "unsupported";
export class PageFetchError extends Error {
  constructor(readonly failure: FetchFailure) {
    super("The page could not be read.");
  }
}
class UnsafeAddressError extends Error {}

const special = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) special.addSubnet(net, prefix, "ipv4");
// Within global unicast: protocol assignments (incl. Teredo), documentation and 6to4, which can tunnel elsewhere.
for (const [net, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) special.addSubnet(net, prefix, "ipv6");
const globalUnicast = new BlockList();
globalUnicast.addSubnet("2000::", 3, "ipv6");

/** Public internet addresses only: no private, loopback, link-local (cloud metadata), shared, reserved or mapped ranges. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !special.check(address, "ipv4");
  if (family === 6) return globalUnicast.check(address, "ipv6") && !special.check(address, "ipv6");
  return false;
}

/** net's lookup hook: resolves, then refuses if any answer isn't public (a mixed answer could still connect privately). */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, "", 0);
    const usable = addresses.filter((a) => !options.family || a.family === options.family);
    if (!usable.length || addresses.some((a) => !isPublicAddress(a.address))) return callback(new UnsafeAddressError(), "", 0);
    if (options.all) callback(null, usable);
    else callback(null, usable[0].address, usable[0].family);
  });
};

/** An HTTPS URL on the default port with a public-looking hostname, or null. Fragments are dropped. */
export function safeUrl(raw: string | URL, base?: URL): URL | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!host.includes(".") || host.startsWith("[") || isIP(host) || /(^|\.)(localhost|local|internal|home\.arpa)\.?$/i.test(host)) return null;
  url.hash = "";
  return url.href.length <= 2048 ? url : null;
}

export interface Fetched {
  url: URL;
  status: number;
  headers: IncomingHttpHeaders;
  /** Read only for 2xx replies with an accepted content type. */
  body: Buffer | null;
}

const decoders = { gzip: createGunzip, "x-gzip": createGunzip, deflate: createInflate, br: createBrotliDecompress } as const;

async function readBody(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const encoding = (response.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  if (encoding !== "identity" && !(encoding in decoders)) throw new PageFetchError("unsupported");
  if (Number(response.headers["content-length"]) > maxBytes) throw new PageFetchError("too_large");
  const decoded: Readable =
    encoding === "identity" ? response : pipeline(response, decoders[encoding as keyof typeof decoders](), () => {});
  // Raw bytes count too, so a stream that decodes to nothing can't run on.
  let raw = 0;
  response.on("data", (chunk: Buffer) => {
    raw += chunk.length;
    if (raw > maxBytes) decoded.destroy(new PageFetchError("too_large"));
  });
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of decoded) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) throw new PageFetchError("too_large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function open(url: URL, accept: string, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        agent: false, // no pooled sockets: every hop connects (and is checked) afresh
        lookup: publicLookup,
        signal,
        headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Encoding": "gzip, deflate, br", "Accept-Language": "en" },
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * GETs a URL, following at most three redirects, each re-checked. The body is
 * read only for a 2xx reply whose content type matches `types`.
 */
export async function fetchPublic(start: URL, options: { accept: string; types: RegExp; maxBytes: number; signal: AbortSignal }): Promise<Fetched> {
  let url: URL | null = safeUrl(start);
  if (!url) throw new PageFetchError("unsafe");
  let response: IncomingMessage | undefined;
  try {
    for (let hop = 0; ; hop++) {
      response = await open(url, options.accept, options.signal);
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.destroy();
        if (hop === MAX_REDIRECTS) throw new PageFetchError("unavailable");
        url = safeUrl(location, url);
        if (!url) throw new PageFetchError("unsafe");
        continue;
      }
      if (status < 200 || status > 299) return { url, status, headers: response.headers, body: null };
      if (!options.types.test(response.headers["content-type"] ?? "")) throw new PageFetchError("unsupported");
      return { url, status, headers: response.headers, body: await readBody(response, options.maxBytes) };
    }
  } catch (error) {
    if (error instanceof PageFetchError) throw error;
    if (error instanceof UnsafeAddressError) throw new PageFetchError("unsafe");
    const aborted = options.signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name));
    throw new PageFetchError(aborted ? "timeout" : "unavailable");
  } finally {
    response?.destroy();
  }
}
