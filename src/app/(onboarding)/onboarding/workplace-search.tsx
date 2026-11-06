"use client";

/**
 * "Where do you work?": search-as-you-type over GET /api/ror?q=, following
 * B2's handoff (db/Workplace-Lookup.md): input capped at 200 characters,
 * requests wait 300 ms after typing, replies for older input are dropped,
 * and a 503 shows as an error, never as "no workplaces found".
 *
 * When a search finds nothing, the list offers the typed text itself
 * ("Use 'Acme Labs'"), so people at organisations missing from the
 * directory can still answer. That saves as rorId: null; see answers.ts.
 *
 * ARIA combobox: the input owns a listbox of options; arrow keys move,
 * Enter picks, Escape closes.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { RorMatch } from "@/contracts/types";
import type { Workplace } from "./answers";
import { countryName } from "./countries";

const MAX_QUERY = 200;
const DEBOUNCE_MS = 300;

type Search =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; results: RorMatch[] }
  | { state: "error"; message: string };

type Option = { kind: "org"; org: RorMatch } | { kind: "custom"; name: string };

function searchErrorMessage(status: number): string {
  if (status === 401) return "Your sign-in has expired. Sign in again to search workplaces.";
  if (status === 400) return "That search is too long. Shorten it and try again.";
  return "Workplace search isn't responding right now. Try again in a moment.";
}

export function WorkplaceSearch({
  value,
  onChange,
  invalid,
}: {
  value: Workplace;
  onChange: (w: Workplace) => void;
  invalid: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search>({ state: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const latest = useRef(0);
  const [retry, setRetry] = useState(0);

  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) return;
    const ticket = ++latest.current;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearch({ state: "loading" });
      try {
        const res = await fetch(`/api/ror?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (ticket !== latest.current) return; // a newer search started
        if (!res.ok) {
          setSearch({ state: "error", message: searchErrorMessage(res.status) });
          return;
        }
        const results = (await res.json()) as RorMatch[];
        if (ticket !== latest.current) return;
        setSearch({ state: "done", results });
        setActive(0); // the first result, or the "Use …" option when there are none
      } catch {
        if (controller.signal.aborted || ticket !== latest.current) return;
        setSearch({ state: "error", message: searchErrorMessage(0) });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, retry]);

  const options: Option[] =
    search.state !== "done"
      ? []
      : search.results.length
        ? search.results.map((org) => ({ kind: "org", org }))
        : [{ kind: "custom", name: trimmed }];
  const showList = open && trimmed.length > 0 && search.state !== "idle";

  function pick(option: Option) {
    onChange(option);
    setOpen(false);
    setQuery("");
    setSearch({ state: "idle" });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && options.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp" && options.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter" && showList && active >= 0 && options[active]) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const noMatches = search.state === "done" && search.results.length === 0;
  const status =
    search.state === "loading"
      ? "Searching workplaces"
      : search.state === "error"
        ? search.message
        : noMatches
          ? `No workplaces match. Press Enter to use ${trimmed} as your workplace.`
          : search.state === "done"
            ? `${options.length} workplace${options.length === 1 ? "" : "s"} found. Use the arrow keys to choose.`
            : "";

  if (value?.kind === "org" || value?.kind === "custom") {
    return (
      <div className="flex min-h-16 items-center gap-3 rounded-xl border-2 border-accent bg-surface px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold leading-snug break-words">
            {value.kind === "org" ? value.org.name : value.name}
          </span>
          <span className="block text-sm text-muted">
            {value.kind === "org" ? countryName(value.org.country) : "Not in the directory"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="min-h-11 rounded-lg px-3 text-sm font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Change<span className="sr-only"> workplace</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={`${id}-input`}
        type="text"
        role="combobox"
        aria-label="Search for your workplace"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 && options[active] ? `${id}-opt-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-status`}
        autoComplete="off"
        maxLength={MAX_QUERY}
        placeholder="Company, university or project"
        value={query}
        disabled={value?.kind === "none"}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value.trim()) setSearch({ state: "idle" });
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        className="min-h-14 w-full rounded-xl border-2 border-border bg-surface px-4 text-lg placeholder:text-muted focus-visible:border-accent focus-visible:outline-none disabled:opacity-60 aria-invalid:border-[#c2410c]"
      />

      <p id={`${id}-status`} role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Workplaces"
          className="absolute inset-x-0 top-full z-20 mt-2 max-h-80 overflow-auto rounded-xl border-2 border-border bg-surface p-1.5 shadow-[0_18px_40px_-18px_rgb(20_33_61/0.45)]"
        >
          {search.state === "loading" && <li className="px-3 py-3 text-muted">Searching…</li>}
          {search.state === "error" && (
            <li className="flex items-center justify-between gap-3 px-3 py-3">
              <span>{search.message}</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setRetry((n) => n + 1)}
                className="min-h-11 shrink-0 rounded-lg px-3 font-semibold text-accent focus-visible:outline-2 focus-visible:outline-accent"
              >
                Try again
              </button>
            </li>
          )}
          {noMatches && (
            <li role="presentation" className="px-3 pb-1 pt-2 text-sm text-muted">
              No match in the directory.
            </li>
          )}
          {options.map((option, i) => (
            <li
              key={option.kind === "org" ? option.org.id : `custom:${option.name}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(option)}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-12 cursor-pointer flex-col justify-center rounded-lg px-3 py-2 ${i === active ? "bg-accent/15" : ""}`}
            >
              {option.kind === "org" ? (
                <>
                  <span className="font-semibold">{option.org.name}</span>
                  <span className="text-sm text-muted">{countryName(option.org.country)}</span>
                </>
              ) : (
                <>
                  <span className="font-semibold break-words">Use “{option.name}”</span>
                  <span className="text-sm text-muted">Add it as your workplace</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
