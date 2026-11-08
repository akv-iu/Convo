/**
 * Page two's calls to the enrichment API (src/contracts/routes.ts). Failures
 * come back as the contract's sanitized code, never the server's text.
 */
import type { z } from "zod";
import { ConnectGitHub, EnrichmentError, type EnrichmentErrorCode } from "@/contracts/enrichment";
import type { RouteBody, RouteResponse } from "@/contracts/routes";

export type Failure = { ok: false; status: number; code: EnrichmentErrorCode | null; retryAfterSeconds: number | null };
export type Result<T> = { ok: true; data: T } | Failure;

/** With a schema, a reply that doesn't match it comes back as a failure, not as data. */
async function call<T>(path: string, init?: RequestInit, schema?: z.ZodType<T>): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", ...init });
  } catch {
    return { ok: false, status: 0, code: null, retryAfterSeconds: null };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok && schema) {
    const parsed = schema.safeParse(body);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: response.status, code: null, retryAfterSeconds: null };
  }
  if (response.ok) return { ok: true, data: body as T };
  const error = EnrichmentError.safeParse(body);
  return {
    ok: false,
    status: response.status,
    code: error.success ? error.data.code : null,
    retryAfterSeconds: error.success ? (error.data.retryAfterSeconds ?? null) : null,
  };
}

const json = (method: "POST" | "PUT", body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const BASE = "/api/profile-enrichment";

export const enrichmentApi = {
  state: () => call<RouteResponse<"enrichmentState">>(BASE),
  saveIdentity: (identity: RouteBody<"saveEnrichmentIdentity">) => call<RouteResponse<"saveEnrichmentIdentity">>(BASE, json("PUT", identity)),
  // Checked: a redirect path must start with /api/auth/, so a bad reply can't send anyone off the site.
  connectGitHub: () => call<RouteResponse<"connectGitHub">>(`${BASE}/github/connect`, json("POST", {}), ConnectGitHub),
  discover: (body: RouteBody<"discoverEnrichment">) => call<RouteResponse<"discoverEnrichment">>(`${BASE}/discover`, json("POST", body)),
  // Multipart: the browser sets the boundary, so no Content-Type here.
  uploadCv: (form: FormData) => call<RouteResponse<"uploadCv">>(`${BASE}/cv`, { method: "POST", body: form }),
  removeCv: (uploadId: string) => call<RouteResponse<"removeCv">>(`${BASE}/cv/${encodeURIComponent(uploadId)}/remove`, json("POST", {})),
  start: (body: RouteBody<"startEnrichment">) => call<RouteResponse<"startEnrichment">>(BASE, json("POST", body)),
};
