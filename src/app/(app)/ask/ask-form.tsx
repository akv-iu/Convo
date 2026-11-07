"use client";

/**
 * A1 step 5: the ask box, then the refine screen. Writing a question and
 * pressing "Sharpen my question" sends POST /api/refine, which saves a new
 * ask and returns the sharper question, its type and a suggested meeting
 * length. "Find people" opens the matches for that ask.
 *
 * There's no route to edit a saved ask, so changing it means asking again
 * (a new ask); the screen says so instead of offering an edit that wouldn't
 * be saved. A blocked ask (422) shows the server's message and nothing is
 * saved. Only one request is in flight at a time.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import type { RefinedAsk } from "@/contracts/types";
import {
  ASK_MAX,
  askProblem,
  examples,
  lengthLabel,
  refineFailure,
  rememberAsk,
  typeLabel,
  type RefineFailure,
} from "./asks";

const headingClass =
  "text-[2.4rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl";
const errorClass = "text-sm font-medium text-[var(--danger)]";

type Result = { askId: string; rawText: string; refined: RefinedAsk };

export function AskForm() {
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<RefineFailure | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  const problem = tried ? askProblem(text) : null;

  // Move focus to the result's heading once it's on screen, so screen readers announce it.
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  async function sharpen() {
    setTried(true);
    setFailure(null);
    if (askProblem(text) || sending) {
      boxRef.current?.focus();
      return;
    }
    setSending(true);
    try {
      const rawText = text.trim();
      const res = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawText }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setFailure(refineFailure(res.status, body));
        boxRef.current?.focus();
        return;
      }
      const done = { askId: body.askId as string, rawText, refined: body.refined as RefinedAsk };
      rememberAsk(done);
      setResult(done);
    } catch {
      setFailure(refineFailure(0, null));
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void sharpen();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl/Cmd+Enter sends; plain Enter is a new line. Never while an input method is composing.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void sharpen();
    }
  }

  function askAgain() {
    setResult(null);
    setTried(false);
    setTimeout(() => boxRef.current?.focus(), 0);
  }

  if (result) {
    return (
      <section aria-labelledby="refined-heading" className="mx-auto flex max-w-2xl flex-col">
        <h1 id="refined-heading" ref={resultRef} tabIndex={-1} className={`${headingClass} focus:outline-none`}>
          Here&apos;s your question
        </h1>
        <p className="mt-3 text-lg text-muted">This is what the people you pick will see.</p>

        <figure className="mt-8 rounded-2xl border-2 border-border bg-surface p-6 shadow-[var(--popover-shadow)]">
          <blockquote className="text-2xl font-semibold leading-snug tracking-tight break-words">
            {result.refined.text}
          </blockquote>
          <figcaption className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full bg-accent/15 px-3 py-1 text-sm font-semibold">
              <span className="sr-only">Type: </span>
              {typeLabel[result.refined.type]}
            </span>
            <span className="rounded-full bg-[var(--skeleton)] px-3 py-1 text-sm font-semibold">
              <span className="sr-only">Length: </span>
              {lengthLabel(result.refined.minutes)}
            </span>
          </figcaption>
        </figure>
        <p className="mt-4 text-sm text-muted">
          <span className="font-semibold">You wrote:</span> {result.rawText}
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button href={`/matches?ask=${encodeURIComponent(result.askId)}`} className="text-lg sm:px-8">
            Find people
          </Button>
          <Button variant="secondary" onClick={askAgain} className="text-lg">
            Ask something else
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted">Asking something else starts a new question; this one stays saved.</p>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex max-w-2xl flex-col" aria-busy={sending}>
      <h1 className={headingClass}>What do you want to ask?</h1>
      <p className="mt-3 text-lg text-muted">
        Say it in your own words. Convo sharpens it and finds people here who can answer.
      </p>

      <label htmlFor="ask-text" className="mt-8 text-xl font-bold leading-snug tracking-tight">
        Your question
      </label>
      <textarea
        id="ask-text"
        ref={boxRef}
        value={text}
        rows={4}
        maxLength={ASK_MAX + 50}
        placeholder="e.g. how does Raft do the voting thing"
        aria-invalid={problem || failure ? true : undefined}
        aria-describedby={["ask-hint", problem && "ask-problem", failure && "ask-failure"].filter(Boolean).join(" ")}
        onChange={(e) => {
          setText(e.target.value);
          setFailure(null);
        }}
        onKeyDown={onKeyDown}
        className="mt-2 min-h-32 w-full resize-y rounded-xl border-2 border-border bg-surface px-4 py-3 text-lg leading-snug placeholder:text-muted focus-visible:border-accent focus-visible:outline-none aria-invalid:border-[var(--danger-border)]"
      />
      <p id="ask-hint" className="mt-2 flex justify-between gap-3 text-sm text-muted">
        <span>Press Ctrl+Enter to send.</span>
        <span>
          {text.trim().length} of {ASK_MAX}
        </span>
      </p>
      {problem && (
        <p id="ask-problem" className={`mt-1 ${errorClass}`}>
          {problem}
        </p>
      )}

      <div className="mt-6">
        <p className="text-sm font-semibold text-muted" id="examples-label">
          Not sure? Try one:
        </p>
        <ul className="mt-2 flex flex-wrap gap-2" aria-labelledby="examples-label">
          {examples.map((ex) => (
            <li key={ex}>
              <button
                type="button"
                onClick={() => {
                  setText(ex);
                  setFailure(null);
                  boxRef.current?.focus();
                }}
                className="min-h-11 rounded-full border-2 border-border bg-surface px-4 text-left text-sm font-medium hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="sticky bottom-0 -mx-4 mt-8 bg-background/95 px-4 pb-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        {failure && (
          <p id="ask-failure" role="alert" className={`mb-3 ${errorClass}`}>
            {failure.message}
            {failure.action && (
              <>
                {" "}
                <a href={failure.action.href} className="underline underline-offset-4">
                  {failure.action.label}
                </a>
              </>
            )}
          </p>
        )}
        <Button type="submit" disabled={sending} className="w-full text-lg sm:w-auto sm:px-8">
          {sending ? "Sharpening…" : "Sharpen my question"}
        </Button>
      </div>
    </form>
  );
}
