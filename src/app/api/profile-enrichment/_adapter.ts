import { connection } from "next/server";
import { fake } from "@/contracts/fake/handlers";
import { MAX_CV_BYTES } from "@/contracts/enrichment";
import { routes, type Ctx, type Handler } from "@/contracts/routes";
import { getUserId } from "@/server/auth";
import { config } from "@/server/config";
import { real } from "@/server/real";

export type EnrichmentRoute = keyof typeof import("@/contracts/fake/enrichment").enrichmentFake;
class InputError extends Error {
  constructor(readonly status: number) { super("Invalid enrichment request."); }
}
const errors: Record<number, { error: string; code: string }> = {
  400: { error: "Check the submitted fields.", code: "bad_request" },
  401: { error: "Sign in with GitHub first.", code: "sign_in_required" },
  403: { error: "Submit this request from the application.", code: "forbidden" },
  404: { error: "Not found.", code: "not_found" },
  409: { error: "This input or draft changed. Review it again.", code: "conflict" },
  413: { error: "The request exceeds the size limit.", code: "too_large" },
  415: { error: "Use the documented content type and file format.", code: "unsupported_media_type" },
  422: { error: "This document cannot be read. Try a text-based file or paste text.", code: "bad_request" },
  429: { error: "Too many attempts. Try again later.", code: "rate_limited" },
  501: { error: "Real profile enrichment is not available yet.", code: "not_ready" },
  503: { error: "Profile enrichment is temporarily unavailable.", code: "unavailable" },
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function readBody(req: Request, multipart: boolean): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!(multipart ? /^multipart\/form-data(?:;|$)/i : /^application\/json(?:;|$)/i).test(contentType)) throw new InputError(415);
  const limit = multipart ? MAX_CV_BYTES + 16_384 : 256 * 1024;
  const reader = req.body?.getReader();
  if (!reader) throw new InputError(400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new InputError(413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body = new Response(bytes, { headers: { "Content-Type": contentType } });
    if (!multipart) return await body.json();
    const form = await body.formData();
    if ([...form.keys()].some(key => !["consent", "file", "text"].includes(key) || form.getAll(key).length !== 1)) throw new InputError(400);
    const file = form.get("file");
    if (file instanceof File) {
      if (file.size > MAX_CV_BYTES) throw new InputError(413);
      if (!["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.type)) throw new InputError(415);
    }
    return { ...Object.fromEntries(form), consent: form.get("consent") === "true" };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError(400);
  }
}

/** Only the new feature uses this adapter; existing JSON routes keep their behavior. */
export function enrichmentApi<N extends EnrichmentRoute>(name: N) {
  const def = routes[name];
  return async (req: Request, context: { params: Promise<Record<string, string>> }): Promise<Response> => {
    await connection();
    if (!config.profileEnrichmentEnabled) return reply({ error: "Profile enrichment is disabled.", code: "feature_disabled" }, 404);
    try {
      const origin = req.headers.get("origin");
      if (req.method !== "GET" && ((origin !== null && origin !== new URL(req.url).origin) || req.headers.get("sec-fetch-site") === "cross-site")) return reply(errors[403], 403);
      const userId = await getUserId(req);
      if (!userId) return reply(errors[401], 401);
      let body: unknown;
      if ("body" in def) {
        const parsed = def.body.safeParse(await readBody(req, "contentType" in def && def.contentType === "multipart/form-data"));
        if (!parsed.success) return reply(errors[400], 400);
        body = parsed.data;
      }
      const ctx = { userId, params: await context.params, query: new URL(req.url).searchParams, body } as Ctx<N>;
      const handler: Handler<N> = config.fakeApi ? fake[name] : real[name];
      const result = def.response.safeParse(await handler(ctx));
      if (!result.success) return reply({ error: "Response did not match the contract.", code: "off_contract" }, 500);
      return reply(result.data);
    } catch (error) {
      if (typeof error === "object" && error && "digest" in error && String(error.digest).startsWith("NEXT_")) throw error;
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 503;
      const safeStatus = Object.hasOwn(errors, status) ? status : 503;
      if (safeStatus === 503) console.warn(`[profile-enrichment] ${name} unavailable`);
      return reply(errors[safeStatus], safeStatus);
    }
  };
}
