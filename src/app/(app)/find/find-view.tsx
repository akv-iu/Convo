"use client";

/**
 * The Find tab: the person finder over everyone at the event (GET /api/find?q=). It's a strict
 * filter, not the request matcher: a country keeps people who show that country; anything else
 * keeps people whose shown workplace, organisations or skills contain it. No question, no AI.
 */
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { CardSkeleton, pageSubtitleClass, pageTitleClass } from "@/components/ui/page";
import { PersonBadge } from "@/components/ui/person-badge";
import type { CardPerson } from "@/contracts/types";

type Load =
  | { state: "idle" }
  | { state: "loading"; query: string }
  | { state: "failed"; query: string }
  | { state: "ready"; query: string; people: CardPerson[] };

const EXAMPLES = ["Spain", "University of Utah", "FHIR", "Kubernetes"];

export function FindView() {
  const [text, setText] = useState("");
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const latest = useRef(0);

  async function find(query: string) {
    const q = query.trim();
    if (!q) return;
    const mine = ++latest.current; // a slower reply for an older search never replaces a newer one
    setLoad({ state: "loading", query: q });
    try {
      const res = await fetch(`/api/find?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("find failed");
      const people = (await res.json()) as CardPerson[];
      if (mine === latest.current) setLoad({ state: "ready", query: q, people });
    } catch {
      if (mine === latest.current) setLoad({ state: "failed", query: q });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void find(text);
  }

  return (
    <section aria-labelledby="find-heading" className="mt-2">
      <h1 id="find-heading" className={pageTitleClass}>
        Find people
      </h1>
      <p className={pageSubtitleClass}>Everyone at the event, by country, workplace, organisation or skill.</p>

      <form role="search" onSubmit={onSubmit} className="mt-6 flex gap-2">
        <label htmlFor="find-search" className="sr-only">
          Find people by country, workplace, organisation or skill
        </label>
        <input
          id="find-search"
          type="search"
          value={text}
          maxLength={200}
          placeholder="Such as Spain, a university or a skill"
          onChange={(e) => setText(e.target.value)}
          className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-border bg-surface px-4 text-base placeholder:text-muted focus-visible:border-accent focus-visible:outline-none"
        />
        <Button type="submit" className="shrink-0">
          Search
        </Button>
      </form>

      <div className="mt-6" aria-live="polite">
        {load.state === "idle" && (
          <div>
            <p className="text-muted">Try one of these:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    onClick={() => (setText(example), void find(example))}
                    className="rounded-full border-2 border-border bg-surface px-3 py-1 text-sm font-semibold transition-colors hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {load.state === "loading" && <CardSkeleton label={`Finding people for ${load.query}…`} count={3} />}
        {load.state === "failed" && (
          <div>
            <p role="alert" className="text-lg">
              The search didn&apos;t work just now.
            </p>
            <div className="mt-4">
              <Button onClick={() => void find(load.query)}>Try again</Button>
            </div>
          </div>
        )}
        {load.state === "ready" && load.people.length === 0 && (
          <p className="rounded-2xl border-2 border-border bg-surface p-5 text-lg">
            No one shows &ldquo;{load.query}&rdquo; on their badge. Try a country, a university, an organisation or a skill.
          </p>
        )}
        {load.state === "ready" && load.people.length > 0 && (
          <>
            <p className="mb-3 font-semibold">
              {load.people.length === 1 ? "1 person" : `${load.people.length} people`} for &ldquo;{load.query}&rdquo;
              {load.people.length === 50 && <span className="font-normal text-muted"> (the first 50; add a word to narrow it)</span>}
            </p>
            <ul className="flex flex-col gap-3">
              {load.people.map((p) => (
                <li key={p.id} className="rounded-2xl border-2 border-border bg-surface p-3">
                  <PersonBadge person={p} />
                  {p.expertise && p.expertise.length > 0 && (
                    <ul aria-label={`${p.name}'s skills`} className="mt-2 flex flex-wrap gap-1.5 px-1">
                      {p.expertise.map((skill) => (
                        <li key={skill} className="rounded-md bg-[var(--skeleton)] px-2 py-0.5 text-xs font-semibold">
                          {skill}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
