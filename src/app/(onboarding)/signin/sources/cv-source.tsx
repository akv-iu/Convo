"use client";

/**
 * Page two's CV section: one PDF/DOCX (2 MiB at most) or pasted text, staged
 * privately until final Continue. A new upload replaces the old one; Remove
 * discards it. The response has only metadata, never the CV's contents.
 */
import { useState } from "react";
import { MAX_CV_BYTES, MAX_SOURCE_TEXT } from "@/contracts/enrichment";
import type { RouteResponse } from "@/contracts/routes";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { Reason } from "../../_components/reasons";
import { enrichmentApi } from "./api";
import { reasonOf } from "./candidates";
import { HowToFix } from "./how-to-fix";

export type CvUpload = RouteResponse<"uploadCv">;

const hintClass = "px-1 text-sm text-muted";
const errorClass = "text-sm font-medium text-[var(--danger)]";
const fieldClass =
  "w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-base placeholder:text-muted focus-visible:border-accent focus-visible:outline-none";

export function CvSource({
  on,
  onToggle,
  upload,
  onUploaded,
  onRemove,
  removeFailed,
  problem,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  upload: CvUpload | null;
  onUploaded: (upload: CvUpload) => void;
  onRemove: () => void;
  removeFailed: boolean;
  problem: Reason | "cv_missing" | null;
}) {
  const [replacing, setReplacing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ reason: Reason; retryAfterSeconds: number | null } | null>(null);

  async function send(form: FormData) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    form.set("consent", "true");
    const result = await enrichmentApi.uploadCv(form);
    setBusy(false);
    if (!result.ok) {
      setFailure({ reason: reasonOf(result), retryAfterSeconds: result.retryAfterSeconds });
      return;
    }
    setReplacing(false);
    setText("");
    onUploaded(result.data);
  }

  function chooseFile(file: File | undefined) {
    if (!file) return;
    // Checked here too so a wrong file gets help without an upload.
    if (file.size > MAX_CV_BYTES) return setFailure({ reason: "cv_too_large", retryAfterSeconds: null });
    if (!/\.(pdf|docx)$/i.test(file.name)) return setFailure({ reason: "cv_unsupported", retryAfterSeconds: null });
    const form = new FormData();
    form.set("file", file);
    void send(form);
  }

  function sendText() {
    if (!text.trim()) return;
    const form = new FormData();
    form.set("text", text.trim());
    void send(form);
  }

  const showForm = !upload || replacing;
  return (
    <section aria-label="CV" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Switch label="CV" checked={on} onChange={onToggle} describedBy="cv-hint" />
        <p id="cv-hint" className={hintClass}>
          Your CV stays private. Only the parts you approve on the last page can appear on your profile and to people you match
          with.
        </p>
      </div>
      {removeFailed && (
        <p role="alert" className={errorClass}>
          Your uploaded CV couldn&apos;t be removed, so CV is still on. Try again.
        </p>
      )}
      {on && upload && !replacing && (
        <div className="flex flex-col gap-2 rounded-xl border-2 border-accent bg-surface px-4 py-3">
          <p className="font-semibold break-words">{upload.filename ?? "Pasted CV text"}</p>
          <p className="text-sm text-muted">{upload.characters.toLocaleString("en")} characters ready to read</p>
          {upload.warnings.map((w) => (
            <HowToFix key={w} reason={w} />
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setReplacing(true)}>
              Replace
            </Button>
            <Button variant="secondary" onClick={onRemove}>
              Remove
            </Button>
          </div>
        </div>
      )}
      {on && showForm && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-semibold">Upload a PDF or Word file (2 MB at most)</span>
            <input
              id="cv-file"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={busy}
              onChange={(e) => {
                chooseFile(e.target.files?.[0]);
                e.target.value = "";
              }}
              className="min-h-11 text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-border file:bg-background file:px-4 file:font-medium"
            />
          </label>
          <p className="text-sm text-muted">Or paste the text:</p>
          <textarea
            aria-label="CV text"
            value={text}
            rows={5}
            maxLength={MAX_SOURCE_TEXT}
            onChange={(e) => setText(e.target.value)}
            className={fieldClass}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={sendText} disabled={busy || !text.trim()}>
              Use this text
            </Button>
            {replacing && (
              <Button variant="secondary" onClick={() => setReplacing(false)}>
                Keep the current one
              </Button>
            )}
          </div>
          {busy && (
            <p role="status" className="text-sm text-muted">
              Uploading…
            </p>
          )}
        </div>
      )}
      {on && failure && <HowToFix reason={failure.reason} retryAfterSeconds={failure.retryAfterSeconds} />}
      {on && problem === "cv_missing" && !upload && (
        <p className={errorClass}>Upload your CV or paste its text, or turn off CV.</p>
      )}
      {on && problem && problem !== "cv_missing" && <HowToFix reason={problem} />}
    </section>
  );
}
