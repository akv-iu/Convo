"use client";

/**
 * A1 step 5: the ask box. Send saves the question exactly as written
 * (POST /api/asks), with the kind of question the asker picked (Learn
 * something unless they change it) and a 5-minute chat. "Sharpen with AI"
 * is optional: it asks for a suggestion (POST /api/refine/preview, which
 * saves and registers nothing) and puts it in the box, where it can be
 * edited, or swapped back for the asker's own words, before sending. Only
 * what's sent is saved. Ctrl/Cmd+Enter sends what's in the box.
 *
 * There's no route to edit a saved ask, so changing one means asking again
 * (a new ask). A blocked ask (422) shows the server's message and nothing is
 * saved. Only one request is in flight at a time.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { AskType, type Ask, type RefinedAsk } from "@/contracts/types";
import { loadAsk } from "../matches/matches";
import {
  ASK_MAX,
  askProblem,
  lengthLabel,
  rememberAsk,
  sendFailure,
  sharpenFailure,
  typeLabel,
  type RefineFailure,
  recallAsk,
} from "./asks";

const headingClass =
  "text-[2.4rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl";
const errorClass = "text-sm font-medium text-[var(--danger)]";

type Result = { askId: string; rawText: string; refined: RefinedAsk; resolved?: boolean };

/** A saved ask as the result screen shows it; an unrefined one shows its raw text. */
function asResult(ask: Ask): Result {
  return {
    askId: ask.id,
    rawText: ask.rawText,
    refined: ask.refined ?? { text: ask.rawText, type: "knowledge", minutes: 5 },
    resolved: ask.status === "resolved",
  };
}

export function AskForm() {
  const router = useRouter();
  /** /ask?ask=<id>: show that saved question (from matches' Back link, a reload or a shared link). */
  const askParam = useSearchParams().get("ask");
  const [readBack, setReadBack] = useState<"loading" | "missing" | "failed" | null>(askParam ? "loading" : null);
  const [readAttempt, setReadAttempt] = useState(0);
  /** The ask this screen just sent; the address then points at it, and it needs no loading. */
  const sentRef = useRef<string | null>(null);
  const [text, setText] = useState("");
  /** The asker's own words while the box holds an AI suggestion; null when it holds their own. */
  const [original, setOriginal] = useState<string | null>(null);
  const [type, setType] = useState<AskType>("knowledge");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<"send" | "sharpen" | null>(null);
  const busyRef = useRef(false);
  const [failure, setFailure] = useState<RefineFailure | null>(null);
  const [announce, setAnnounce] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  const problem = tried ? askProblem(text) : null;

  // Read the saved question back: this tab's copy at once, then the server's (the truth).
  useEffect(() => {
    if (!askParam || sentRef.current === askParam) return; // nothing to show, or just sent here
    let live = true;
    void (async () => {
      const kept = recallAsk(askParam);
      if (kept) setResult(kept);
      else setReadBack("loading");
      const ask = await loadAsk(askParam);
      if (!live) return;
      if (typeof ask === "number") {
        // Someone else's ask, or one that's gone, is a 404 (401 when signed out): start fresh.
        const missing = ask === 404 || ask === 401;
        setReadBack(missing ? "missing" : "failed");
        if (missing) setResult(null);
        return;
      }
      setReadBack(null);
      setResult(asResult(ask));
    })();
    return () => {
      live = false;
    };
  }, [askParam, readAttempt]);

  // Move focus to the result's heading once it's on screen, so screen readers announce it.
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  /** Runs one request at a time; false (and focus back in the box) if the text isn't ready. */
  function start(kind: "send" | "sharpen"): boolean {
    setTried(true);
    setFailure(null);
    if (busyRef.current) return false;
    if (askProblem(text)) {
      boxRef.current?.focus();
      return false;
    }
    busyRef.current = true;
    setBusy(kind);
    return true;
  }

  function finish() {
    busyRef.current = false;
    setBusy(null);
  }

  async function send() {
    if (!start("send")) return;
    const question = text.trim();
    try {
      const res = await fetch("/api/asks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: question, type }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setFailure(sendFailure(res.status, body));
        boxRef.current?.focus();
        return;
      }
      const saved = body as { askId: string; ask: Ask };
      // Saved as written, so its refined text is exactly what was sent.
      const done = { askId: saved.askId, rawText: original ?? question, refined: saved.ask.refined ?? { text: question, type, minutes: 5 } };
      rememberAsk(done);
      setResult(done);
      sentRef.current = done.askId;
      // Keep it in the address, so a reload or the matches' Back link comes back to it.
      router.replace(`/ask?ask=${encodeURIComponent(done.askId)}`, { scroll: false });
    } catch {
      setFailure(sendFailure(0, null));
    } finally {
      finish();
    }
  }

  async function sharpen() {
    if (!start("sharpen")) return;
    try {
      const res = await fetch("/api/refine/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setFailure(sharpenFailure(res.status, body));
        boxRef.current?.focus();
        return;
      }
      const suggestion = (body as { refined: RefinedAsk }).refined;
      setOriginal((kept) => kept ?? text); // sharpening a suggestion again still reverts to the asker's words
      setText(suggestion.text);
      setType(suggestion.type);
      setAnnounce("Sharpened. Edit the suggestion, use your original, or send it.");
      boxRef.current?.focus();
    } catch {
      setFailure(sharpenFailure(0, null));
    } finally {
      finish();
    }
  }

  function revertToOriginal() {
    if (original === null) return;
    setText(original);
    setOriginal(null);
    setFailure(null);
    setAnnounce("Back to your own words.");
    boxRef.current?.focus();
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl/Cmd+Enter sends what's in the box; plain Enter is a new line. Never while an input method is composing.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  /** Back to the box with the sent text kept, as the asker's own words to start a new question from. */
  function askAgain() {
    // Start from the question shown, if the box is empty (e.g. it was read back from a link).
    if (!text.trim() && result) setText(result.refined.text);
    setResult(null);
    setTried(false);
    setOriginal(null);
    setAnnounce("");
    setReadBack(null);
    sentRef.current = null;
    if (askParam) router.replace("/ask", { scroll: false });
    setTimeout(() => boxRef.current?.focus(), 0);
  }

  if (result) {
    return (
      <section aria-labelledby="refined-heading" className="mx-auto flex max-w-2xl flex-col">
        <h1 id="refined-heading" ref={resultRef} tabIndex={-1} className={`${headingClass} focus:outline-none`}>
          Current request
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
        {result.rawText.trim() !== result.refined.text && (
          <p className="mt-4 text-sm text-muted">
            <span className="font-semibold">You first wrote:</span> {result.rawText}
          </p>
        )}

        {result.resolved && (
          <p className="mt-4 rounded-xl border-2 border-border px-4 py-3 font-medium">
            You marked this question as answered, so Lanyard no longer matches it with anyone new.
          </p>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {!result.resolved && (
            <Button href={`/matches?ask=${encodeURIComponent(result.askId)}`} className="text-lg sm:px-8">
              Find people
            </Button>
          )}
          <Button variant="secondary" onClick={askAgain} className="text-lg">
            Ask something else
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted">Asking something else starts a new question; this one stays saved.</p>
      </section>
    );
  }

  if (readBack === "loading") {
    return (
      <p role="status" className="mx-auto max-w-2xl text-lg">
        Loading your question…
      </p>
    );
  }

  const sharpened = original !== null;
  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex max-w-2xl flex-col" aria-busy={busy !== null}>
      {readBack === "missing" && (
        <p role="alert" className={`mb-4 ${errorClass}`}>
          That question isn&apos;t one of yours, or it no longer exists. Ask a new one below.
        </p>
      )}
      {readBack === "failed" && (
        <p role="alert" className={`mb-4 ${errorClass}`}>
          Your question didn&apos;t load.{" "}
          <button
            type="button"
            onClick={() => setReadAttempt((n) => n + 1)}
            className="underline underline-offset-4"
          >
            Try again
          </button>
        </p>
      )}
      {/* One prompt: the heading is the box's label. */}
      <h1 className={headingClass}>
        <label htmlFor="ask-text">What do you want to ask?</label>
      </h1>
      <textarea
        id="ask-text"
        ref={boxRef}
        value={text}
        rows={4}
        maxLength={ASK_MAX + 50}
        placeholder="e.g. how does Raft do the voting thing"
        aria-invalid={problem || failure ? true : undefined}
        aria-describedby={["ask-hint", sharpened && "ask-sharpened", problem && "ask-problem", failure && "ask-failure"]
          .filter(Boolean)
          .join(" ")}
        onChange={(e) => {
          setText(e.target.value);
          setFailure(null);
        }}
        onKeyDown={onKeyDown}
        className="mt-6 min-h-32 w-full resize-y rounded-xl border-2 border-border bg-surface px-4 py-3 text-lg leading-snug placeholder:text-muted focus-visible:border-accent focus-visible:outline-none aria-invalid:border-[var(--danger-border)]"
      />
      {sharpened && (
        <p id="ask-sharpened" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-accent/10 px-3 py-2 text-sm">
          <span className="font-semibold">Sharpened with AI.</span>{" "}
          <span className="text-muted">Edit it as you like, or</span>{" "}
          <button
            type="button"
            onClick={revertToOriginal}
            className="min-h-8 font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            use my original
          </button>
        </p>
      )}
      <p id="ask-hint" className="mt-2 flex justify-between gap-3 text-sm text-muted">
        <span>Press Ctrl+Enter to send it as it is.</span>
        <span>
          {text.trim().length} of {ASK_MAX}
        </span>
      </p>
      {problem && (
        <p id="ask-problem" className={`mt-1 ${errorClass}`}>
          {problem}
        </p>
      )}

      <fieldset className="mt-6 border-0 p-0">
        <legend className="mb-2 text-base font-semibold">What kind of question is it?</legend>
        <div className="flex flex-wrap gap-2">
          {AskType.options.map((t) => (
            <label
              key={t}
              className="flex min-h-11 cursor-pointer items-center rounded-full border-2 border-border bg-surface px-4 font-semibold transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent motion-reduce:transition-none"
            >
              <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="sr-only" />
              {typeLabel[t]}
            </label>
          ))}
        </div>
      </fieldset>

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

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
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="submit"
            aria-disabled={busy !== null}
            className="text-lg aria-disabled:cursor-not-allowed aria-disabled:opacity-60 sm:px-8"
          >
            {busy === "send" ? "Sending…" : "Send"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void sharpen()}
            aria-disabled={busy !== null}
            className="text-lg aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            {busy === "sharpen" ? "Sharpening…" : sharpened ? "Sharpen again" : "Sharpen with AI"}
          </Button>
        </div>
      </div>
    </form>
  );
}
