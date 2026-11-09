"use client";

/**
 * Visible confirmations: a short message at the bottom of the screen after an action (request
 * sent, passed, accepted, booked). Screens already announce the same thing to screen readers in
 * their own status line, so the toast itself is hidden from them to avoid saying it twice.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; message: string; tone: "done" | "neutral" };
const ToastContext = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});

/** Shows a confirmation for a few seconds: `toast("Request sent to Priya")`. */
export function useToast() {
  return useContext(ToastContext);
}

const SHOW_MS = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const next = useRef(0);
  const show = useCallback((message: string, tone: Toast["tone"] = "done") => {
    next.current += 1;
    setToast({ id: next.current, message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), SHOW_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {toast && (
          <div
            key={toast.id}
            className={`flex items-center gap-2 rounded-full px-5 py-3 font-semibold shadow-[var(--popover-shadow)] motion-safe:animate-[toast-in_200ms_ease-out] ${
              toast.tone === "done" ? "bg-success text-on-success" : "bg-foreground text-background"
            }`}
          >
            {toast.tone === "done" && <span>✓</span>}
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
