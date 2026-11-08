/**
 * CV text extraction for the authenticated upload operation. The caller owns
 * consent, ownership, storage, expiry and contact-data scrubbing; this only
 * turns at most 2 MiB of PDF/DOCX bytes into bounded plain text.
 *
 * The format comes from the file's own signature, never its name or MIME type.
 * Parsing (unpdf, Mammoth) runs in a worker thread that is terminated, not
 * merely abandoned, when it runs past its deadline, its V8 heap limit, or the
 * process memory-growth allowance (decoded PDF streams live outside the heap).
 * Nothing is logged, stored or fetched, and no copy of the file outlives the call.
 */
import { Worker } from "node:worker_threads";
import { MAX_CV_BYTES, MAX_SOURCE_TEXT } from "@/contracts/enrichment";
import { enrichmentError } from "./model";

export const CV_LIMITS = { timeoutMs: 8_000, heapMb: 128, growthMb: 384 };
export type CvLimits = typeof CV_LIMITS;
export type CvFormat = "pdf" | "docx";
export type CvWarning = "cv_truncated";
/** What the worker sends back: text already tidied and cut to MAX_SOURCE_TEXT, or a contract reason. */
export type CvWorkerResult = { text: string; truncated: boolean } | { failure: "cv_unsupported" | "cv_encrypted" | "cv_unreadable" };

const startsWith = (bytes: Uint8Array, signature: number[], at = 0) => signature.every((byte, i) => bytes[at + i] === byte);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** PDF (header within the first KiB, as readers allow) or ZIP; an OLE file is legacy .doc or an Office-encrypted DOCX. */
function sniff(bytes: Uint8Array): CvFormat {
  if (startsWith(bytes, ZIP)) return "docx";
  if (startsWith(bytes, OLE)) {
    // Office stores a password-protected .docx as an OLE file holding an "EncryptedPackage" stream.
    const encrypted = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(Buffer.from("EncryptedPackage", "utf16le"));
    enrichmentError(encrypted ? "cv_encrypted" : "cv_unsupported", encrypted ? 422 : 415);
  }
  for (let at = 0; at <= Math.min(1024, bytes.length - PDF.length); at++) if (startsWith(bytes, PDF, at)) return "pdf";
  enrichmentError("cv_unsupported", 415);
}

const MIB = 1024 * 1024;

// At most this many parsers per process, so their memory stays bounded; later uploads wait their turn.
// ponytail: unbounded wait queue (each turn is at most timeoutMs); owners' upload rate limit keeps it short.
const PARALLEL = 2;
let running = 0;
const waiting: (() => void)[] = [];
async function takeSlot(): Promise<void> {
  if (running < PARALLEL) running++;
  else await new Promise<void>((resolve) => waiting.push(resolve)); // the slot is handed over, not re-counted
}
function releaseSlot(): void {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

/** null: the document hit a limit (deadline, heap or memory growth). "broken": the worker itself failed, a server fault. */
function parseInWorker(format: CvFormat, bytes: Uint8Array, limits: CvLimits): Promise<CvWorkerResult | null | "broken"> {
  // The worker gets its own copy, transferred, so the caller's buffer is untouched and nothing is shared.
  const copy = bytes.slice();
  const worker = new Worker(new URL("./cv-worker.mts", import.meta.url), {
    workerData: { cvParser: true, format, bytes: copy, maxText: MAX_SOURCE_TEXT },
    transferList: [copy.buffer],
    resourceLimits: { maxOldGenerationSizeMb: limits.heapMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    // Captured and discarded: a parser warning must never reach the server's logs.
    stdout: true,
    stderr: true,
    env: {},
  });
  worker.stdout.resume();
  worker.stderr.resume();
  const baseline = process.memoryUsage.rss();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CvWorkerResult | null | "broken") => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearInterval(watchdog);
      // terminate() stops running JavaScript, so a stuck parser can't keep the thread or its memory.
      void worker.terminate().finally(() => resolve(result));
    };
    const deadline = setTimeout(() => finish(null), limits.timeoutMs);
    // Process-wide RSS: the other parse slot's growth counts here too, so the allowance covers both.
    const watchdog = setInterval(() => {
      if (process.memoryUsage.rss() - baseline > limits.growthMb * MIB) finish(null);
    }, 20);
    worker.once("message", (message: CvWorkerResult) => finish(message));
    // The worker catches every parser error itself, so an error event is heap exhaustion (the document's
    // fault) or a worker that couldn't run (ours). Only the code is read; the message is never logged.
    worker.once("error", (error: Error & { code?: string }) => finish(error.code === "ERR_WORKER_OUT_OF_MEMORY" ? null : "broken"));
    worker.once("exit", () => finish("broken"));
  });
}

/**
 * Bounded plain text from a PDF or DOCX CV: at most MAX_SOURCE_TEXT characters, with cv_truncated
 * when shortened. Throws StateError cv_too_large (413), cv_unsupported (415), cv_encrypted or cv_unreadable (422),
 * or unknown (500) when the parser couldn't run at all.
 */
export async function extractCvText(bytes: Uint8Array, limits: CvLimits = CV_LIMITS): Promise<{ text: string; warnings: CvWarning[] }> {
  if (bytes.byteLength > MAX_CV_BYTES) enrichmentError("cv_too_large", 413);
  const format = sniff(bytes);
  await takeSlot();
  let result: Awaited<ReturnType<typeof parseInWorker>>;
  try {
    result = await parseInWorker(format, bytes, limits);
  } finally {
    releaseSlot();
  }
  // Not the document's fault, so not reported as unreadable.
  if (result === "broken") enrichmentError("unknown", 500);
  if (!result || "failure" in result) {
    const failure = result?.failure ?? "cv_unreadable";
    enrichmentError(failure, failure === "cv_unsupported" ? 415 : 422);
  }
  if (typeof result.text !== "string" || result.text.length > MAX_SOURCE_TEXT) enrichmentError("cv_unreadable", 422);
  return { text: result.text, warnings: result.truncated ? ["cv_truncated"] : [] };
}
