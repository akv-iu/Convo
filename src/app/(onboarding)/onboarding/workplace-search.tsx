"use client";

/**
 * "Where do you work?": search-as-you-type over GET /api/ror?q=, following
 * B2's handoff (db/Workplace-Lookup.md): input capped at 200 characters,
 * requests wait 300 ms after typing, replies for older input are dropped,
 * and a 503 shows as an error, never as "no workplaces found".
 *
 * ARIA combobox: the input owns a listbox of results; arrow keys move,
 * Enter picks, Escape closes.
 *
 * Not every workplace is in the directory, so the list always ends with
 * "Use “what you typed”", and a failing search offers the same. A typed
 * workplace is saved as Person.workplaceName with no ROR ID
 * (db/Frontend-Support.md): a display label, not a verified organisation.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { RorMatch } from "@/contracts/types";
import { countryName } from "./countries";
import type { Workplace } from "./answers";

const MAX_QUERY = 200;
const DEBOUNCE_MS = 300;

type Search =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; results: RorMatch[] }
  | { state: "error"; message: string };

function searchErrorMessage(status: number): string {
  // Step 1 runs before sign-in; real /api/ror needs a session until B allows signed-out lookups.
  if (status === 401) return "Workplace search isn't available yet. Use the name as you typed it, or try again later.";
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
        if (controller.signal.aborted || ticket !== latest.current) return;
        if (!res.ok) {
          setSearch({ state: "error", message: searchErrorMessage(res.status) });
          return;
        }
        const results = (await res.json()) as RorMatch[];
        if (controller.signal.aborted || ticket !== latest.current) return;
        setSearch({ state: "done", results });
        setActive(0);
      } catch (err) {
        if (controller.signal.aborted || ticket !== latest.current) return;
        void err;
        setSearch({ state: "error", message: searchErrorMessage(0) });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, retry]);

  const results = search.state === "done" ? search.results : [];
  // The last option is always the name as typed.
  const optionCount = search.state === "done" ? results.length + 1 : 0;
  const customIndex = results.length;
  const showPanel = open && trimmed.length > 0 && search.state !== "idle";
  const showList = showPanel && optionCount > 0;

  useEffect(() => {
    if (showList && active >= 0) {
      document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [showList, active, id]);

  function pick(org: RorMatch) {
    onChange({ kind: "org", org });
    setOpen(false);
    setQuery("");
    setSearch({ state: "idle" });
  }

  function chooseTyped() {
    if (!trimmed) return;
    onChange({ kind: "custom", name: trimmed });
    setOpen(false);
    setQuery("");
    setSearch({ state: "idle" });
  }

  function pickActive() {
    if (active === customIndex) chooseTyped();
    else if (results[active]) pick(results[active]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && optionCount) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % optionCount);
    } else if (e.key === "ArrowUp" && optionCount) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? optionCount - 1 : i - 1));
    } else if (e.key === "Enter" && open && trimmed) {
      e.preventDefault();
      if (showList && active >= 0) pickActive();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const status =
    search.state === "loading"
      ? "Searching workplaces"
      : search.state === "error"
        ? search.message
        : search.state === "done"
          ? results.length
            ? `${results.length} workplace${results.length === 1 ? "" : "s"} found. Use the arrow keys to choose.`
            : "No workplaces match that. Press Enter to use the name as you typed it, or try another name."
          : "";

  if (value?.kind === "org" || value?.kind === "custom") {
    return (
      <div className="flex min-h-16 items-center gap-3 rounded-xl border-2 border-accent bg-surface px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold leading-snug break-words">
            {value.kind === "org" ? value.org.name : value.name}
          </span>
          <span className="block text-sm text-muted">
            {value.kind === "org" ? countryName(value.org.country) : "Added by you"}
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
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <input
        ref={inputRef}
        id={`${id}-input`}
        type="text"
        role="combobox"
        aria-label="Search for your workplace"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-status`}
        autoComplete="off"
        maxLength={MAX_QUERY}
        placeholder="Company, university or project"
        value={query}
        disabled={value?.kind === "none"}
        onChange={(e) => {
          if (e.target.value.trim() !== trimmed) {
            latest.current++;
            setSearch({ state: "idle" });
            setActive(-1);
          }
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="min-h-14 w-full rounded-xl border-2 border-border bg-surface px-4 text-lg placeholder:text-muted focus-visible:border-accent focus-visible:outline-none disabled:opacity-60 aria-invalid:border-[var(--danger-border)]"
      />

      <p id={`${id}-status`} role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {showPanel && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-xl border-2 border-border bg-surface p-1.5 shadow-[var(--popover-shadow)]">
          {search.state === "loading" && <p className="px-3 py-3 text-muted">Searching…</p>}
          {search.state === "error" && (
            <>
              <div className="flex items-center justify-between gap-3 px-3 py-3">
                <span>{search.message}</span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    inputRef.current?.focus();
                    setRetry((n) => n + 1);
                  }}
                  className="min-h-11 shrink-0 rounded-lg px-3 font-semibold text-accent focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Try again
                </button>
              </div>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={chooseTyped}
                className="flex min-h-12 w-full items-center rounded-lg px-3 py-2 text-left font-semibold hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="min-w-0 break-words">Use &ldquo;{trimmed}&rdquo;</span>
              </button>
            </>
          )}
          {search.state === "done" && results.length === 0 && (
            <p className="px-3 pt-3 pb-1 text-muted">No workplaces match that.</p>
          )}
          {showList && (
            <ul id={listId} role="listbox" aria-label="Workplaces" tabIndex={-1} className="max-h-80 overflow-auto">
              {results.map((org, i) => (
                <li
                  key={org.id}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(org)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex min-h-12 cursor-pointer flex-col justify-center rounded-lg px-3 py-2 ${i === active ? "bg-accent/15" : ""}`}
                >
                  <span className="font-semibold">{org.name}</span>
                  <span className="text-sm text-muted">{countryName(org.country)}</span>
                </li>
              ))}
              <li
                id={`${id}-opt-${customIndex}`}
                role="option"
                aria-selected={active === customIndex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={chooseTyped}
                onMouseEnter={() => setActive(customIndex)}
                className={`flex min-h-12 cursor-pointer flex-col justify-center rounded-lg px-3 py-2 ${results.length ? "mt-1 border-t border-border" : ""} ${active === customIndex ? "bg-accent/15" : ""}`}
              >
                <span className="font-semibold break-words">Use &ldquo;{trimmed}&rdquo;</span>
                <span className="text-sm text-muted">Not listed? Add it as you typed it.</span>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
