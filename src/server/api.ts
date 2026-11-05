/**
 * Turns a contract handler into a Next.js route handler. Picks the fake or
 * the real implementation, parses the body, resolves the user, and checks
 * the response against the contract.
 */
import { connection, NextResponse } from "next/server";
import { fake } from "@/contracts/fake/handlers";
import { routes, type Ctx, type Handler, type RouteName } from "@/contracts/routes";
import { getUserId } from "@/server/auth";
import { config } from "@/server/config";

type RouteContext = { params: Promise<Record<string, string>> };

export function api<N extends RouteName>(name: N, real: Handler<N>) {
  const def = routes[name];
  return async (req: Request, context: RouteContext): Promise<Response> => {
    const impl = config.fakeApi ? fake[name] : real;
    await connection(); // every route depends on the request; never prerender
    try {
      const userId = await getUserId(req);
      if (!userId) return NextResponse.json({ error: "sign in first" }, { status: 401 });
      const params = await context.params;
      const query = new URL(req.url).searchParams;
      let body: unknown = undefined;
      if ("body" in def && def.body) {
        const parsed = def.body.safeParse(await req.json().catch(() => undefined));
        if (!parsed.success) return NextResponse.json({ error: "bad request", issues: parsed.error.issues }, { status: 400 });
        body = parsed.data;
      }
      const ctx = { userId, params, query, body } as Ctx<N>;
      const result = await impl(ctx);
      const checked = def.response.safeParse(result);
      if (!checked.success) {
        console.error(`[api] ${name} returned something off-contract`, checked.error.issues);
        return NextResponse.json({ error: "response did not match the contract" }, { status: 500 });
      }
      return NextResponse.json(checked.data);
    } catch (err) {
      if (typeof err === "object" && err && "digest" in err && String(err.digest).startsWith("NEXT_")) throw err;
      const status = typeof err === "object" && err && "status" in err ? Number(err.status) : 500;
      const message = err instanceof Error ? err.message : "unknown error";
      if (status === 500) console.error(`[api] ${name} failed`, err);
      return NextResponse.json({ error: message }, { status });
    }
  };
}

export function notImplemented<N extends RouteName>(owner: string): Handler<N> {
  return async () => {
    const err = new Error(`Not built yet (${owner}). Run with FAKE_API=1 to use the fake.`) as Error & { status: number };
    err.status = 501;
    throw err;
  };
}
