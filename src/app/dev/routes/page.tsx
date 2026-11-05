import type { Metadata } from "next";
import { routes } from "@/contracts/routes";
import { config } from "@/server/config";

export const metadata: Metadata = { title: "API contract" };

export default function RoutesPage() {
  const list = Object.entries(routes);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">API contract</h1>
      <p className="mt-2 text-muted">
        {list.length} routes. Defined in <code>src/contracts/routes.ts</code>.{" "}
        {config.fakeApi ? "Every route is answering from the fake right now." : "Routes that are not built yet answer 501."}
      </p>
      <ul className="mt-6 divide-y divide-border">
        {list.map(([name, r]) => {
          const tryable = r.method === "GET" && !r.path.includes(":");
          const href = r.path.endsWith("?q=") ? `${r.path}gra` : r.path;
          return (
            <li key={name} className="flex flex-col gap-1 py-3">
              <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
                <span className="rounded bg-foreground px-1.5 py-0.5 text-xs font-semibold text-background">{r.method}</span>
                {tryable ? (
                  <a href={href} className="underline underline-offset-4">
                    {r.path}
                  </a>
                ) : (
                  <span>{r.path}</span>
                )}
                <span className="ml-auto text-xs text-muted">{r.usedBy}</span>
              </div>
              <p className="text-sm text-muted">{r.description}</p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
