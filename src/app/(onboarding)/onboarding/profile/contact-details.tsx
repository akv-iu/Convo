"use client";

/**
 * Step 4: your contact details and what Lanyard shares once you agree to meet someone. Private:
 * never on your badge or in anyone's matches. When you accept a request, or someone accepts yours,
 * that one person gets what you pick here (email by default) and you get theirs.
 * Saved with "Yes, that's me" (PUT /api/me/contact).
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ContactDetails, type ContactShare } from "@/contracts/types";
import { saveErrorMessage } from "../answers";

type Fields = { email: string; phone: string; share: ContactShare };

const SHARE_OPTIONS: { value: ContactShare; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "both", label: "Both" },
];

export function useContactDetails() {
  const [fields, setFields] = useState<Fields>({ email: "", phone: "", share: "email" });
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [load, setLoad] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  /** Typed before the saved details arrived: what they typed wins. */
  const edited = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/me/contact", { cache: "no-store" });
        const saved = res.ok ? ContactDetails.safeParse(await res.json()).data : undefined;
        if (!live) return;
        if (!saved) return setLoad("failed");
        if (!edited.current) setFields({ email: saved.email ?? "", phone: saved.phone ?? "", share: saved.share });
        setLoad("ready");
      } catch {
        if (live) setLoad("failed");
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  function update(changes: Partial<Fields>) {
    edited.current = true;
    setFields((cur) => ({ ...cur, ...changes }));
    setProblem(null);
  }

  function retry() {
    setLoad("loading");
    setAttempt((n) => n + 1);
  }

  /** Checks and saves; true when saved. The first problem is shown and its field focused. */
  async function save(): Promise<boolean> {
    if (saving) return false;
    const email = fields.email.trim();
    const phone = fields.phone.trim();
    const need = (id: string, message: string) => {
      setProblem(message);
      document.getElementById(id)?.focus();
      return false;
    };
    // Both empty is fine: nothing is shared, and finishing onboarding never waits on contact details.
    const any = Boolean(email || phone);
    if (any && fields.share !== "phone" && !email) return need("contact-email", "Add the email you want to share when you agree to meet.");
    if (any && fields.share !== "email" && !phone) return need("contact-phone", "Add the phone number you want to share when you agree to meet.");
    const parsed = ContactDetails.safeParse({ email: email || null, phone: phone || null, share: fields.share });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0] === "phone" ? "contact-phone" : "contact-email";
      return need(field, field === "contact-phone" ? "Enter a phone number, e.g. +44 7700 900123." : "Enter an email address, e.g. ana@example.com.");
    }
    setSaving(true);
    try {
      const res = await fetch("/api/me/contact", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        setProblem(saveErrorMessage(res.status, await res.json().catch(() => null)));
        return false;
      }
      return true;
    } catch {
      setProblem(saveErrorMessage(0, null));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { fields, update, save, saving, problem, load, retry };
}

const inputClass =
  "min-h-12 w-full rounded-xl border-2 border-border bg-background px-4 text-base placeholder:text-muted focus-visible:border-accent focus-visible:outline-none";

export function ContactSection({ contact }: { contact: ReturnType<typeof useContactDetails> }) {
  const { fields, update, problem, load, retry } = contact;
  return (
    <section aria-labelledby="contact-heading" className="mt-10 rounded-2xl border-2 border-border bg-surface p-5">
      <h2 id="contact-heading" className="text-2xl font-extrabold tracking-tight">
        Contact details
      </h2>
      <p className="mt-1 max-w-2xl text-muted">
        Private: never on your badge. When you accept someone&apos;s request, or they accept yours, Lanyard shares what you
        pick here with that one person, and you get theirs.
      </p>
      {load === "failed" && (
        <div className="mt-4">
          <p role="alert" className="font-medium text-[var(--danger)]">
            Your saved contact details didn&apos;t load. Try again before you change them.
          </p>
          <Button variant="secondary" className="mt-3" onClick={retry}>
            Try again
          </Button>
        </div>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="contact-email" className="font-semibold">
            Email
          </label>
          <input
            id="contact-email"
            type="email"
            autoComplete="email"
            value={fields.email}
            maxLength={254}
            placeholder="you@example.com"
            onChange={(e) => update({ email: e.target.value })}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="contact-phone" className="font-semibold">
            Phone <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="contact-phone"
            type="tel"
            autoComplete="tel"
            value={fields.phone}
            maxLength={24}
            placeholder="+44 7700 900123"
            onChange={(e) => update({ phone: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>
      <fieldset className="mt-4 border-0 p-0">
        <legend className="mb-2 font-semibold">Share when you agree to meet</legend>
        <div className="flex flex-wrap gap-2">
          {SHARE_OPTIONS.map((o) => (
            <label key={o.value} className="cursor-pointer">
              <input
                type="radio"
                name="contact-share"
                value={o.value}
                checked={fields.share === o.value}
                onChange={() => update({ share: o.value })}
                className="peer sr-only"
              />
              <span className="flex min-h-11 items-center rounded-full border-2 border-border px-4 font-semibold transition-colors peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent motion-reduce:transition-none">
                {o.label}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">Email is shared by default. You can change this later.</p>
      </fieldset>
      {problem && (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--danger)]">
          {problem}
        </p>
      )}
    </section>
  );
}
