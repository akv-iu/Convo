/**
 * Runs inside the worker thread cv-parser.ts starts for one CV, and is terminated
 * with it. Reads only the bytes it is given: no files, network or environment.
 * Posts tidied text cut to `maxText`, or a contract reason; never the parser's error text.
 * Imported anywhere else (the unit tests), it only exports extractText.
 */
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { inflateRawSync } from "node:zlib";
import { extractRawText } from "mammoth";
import { getDocumentProxy } from "unpdf";
import type { CvFormat, CvWorkerResult } from "./cv-parser";

type Reason = Extract<CvWorkerResult, { failure: string }>["failure"];
// No parameter properties: Node runs this file with type stripping, which only erases types.
class Failure extends Error {
  readonly reason: Reason;
  constructor(reason: Reason) {
    super(reason);
    this.reason = reason;
  }
}

const MAX_PDF_PAGES = 20;
const MAX_ZIP_ENTRIES = 500;
// Every part of the DOCX together, decompressed. Real CVs use a few MiB at most (mostly images).
const MAX_DOCX_EXPANDED = 20 * 1024 * 1024;

/**
 * One central-directory entry at `at`: refuses encryption, unknown compression and sizes past the
 * remaining budget, then decompresses it under a hard output cap and checks it matches its declared
 * size. Returns its name, decompressed size and the next entry's offset.
 */
function checkEntry(zip: Buffer, at: number, budget: number): { name: string; size: number; next: number } {
  if (zip.readUInt32LE(at) !== 0x02014b50) throw new Failure("cv_unreadable");
  const method = zip.readUInt16LE(at + 10);
  const packed = zip.readUInt32LE(at + 20);
  const size = zip.readUInt32LE(at + 24);
  const nameLength = zip.readUInt16LE(at + 28);
  const local = zip.readUInt32LE(at + 42);
  if (zip.readUInt16LE(at + 8) & 1) throw new Failure("cv_encrypted");
  if ((method !== 0 && method !== 8) || size > budget || zip.readUInt32LE(local) !== 0x04034b50) throw new Failure("cv_unreadable");
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  if (start + packed > zip.length) throw new Failure("cv_unreadable");
  const data = zip.subarray(start, start + packed);
  // inflateRawSync stops (throws) once output passes maxOutputLength, so a lying entry can't expand further.
  const actual = method === 0 ? data.length : inflateRawSync(data, { maxOutputLength: Math.max(size, 1) }).length;
  if (actual !== size) throw new Failure("cv_unreadable");
  return {
    name: zip.toString("utf8", at + 46, at + 46 + nameLength),
    size,
    next: at + 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32),
  };
}

/**
 * The DOCX container, checked before Mammoth (JSZip) reads it: a single-disk ZIP of at most
 * MAX_ZIP_ENTRIES entries, together expanding to at most MAX_DOCX_EXPANDED, with Word's parts.
 * Reads past the end of the buffer throw RangeError, which the caller treats as unreadable.
 */
function checkDocx(zip: Buffer): void {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Failure("cv_unreadable");
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  if (count > MAX_ZIP_ENTRIES || at + zip.readUInt32LE(eocd + 12) > eocd) throw new Failure("cv_unreadable");
  const names = new Set<string>();
  let budget = MAX_DOCX_EXPANDED;
  for (let i = 0; i < count; i++) {
    const entry = checkEntry(zip, at, budget);
    names.add(entry.name);
    budget -= entry.size;
    at = entry.next;
  }
  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) throw new Failure("cv_unsupported");
}

async function docxText(bytes: Uint8Array): Promise<{ text: string; truncated: boolean }> {
  const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    checkDocx(zip);
  } catch (error) {
    throw error instanceof Failure ? error : new Failure("cv_unreadable");
  }
  // Mammoth leaves external file references unread by default (externalFileAccess: false).
  return { text: (await extractRawText({ buffer: zip })).value, truncated: false };
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; truncated: boolean }> {
  const pdf = await getDocumentProxy(bytes, {
    verbosity: 0, useSystemFonts: false, disableFontFace: true, enableXfa: false, maxImageSize: 16_777_216,
  }).catch((error: unknown) => {
    // A user password is needed; an owner-only password (copy/print restrictions) still opens.
    throw new Failure(error instanceof Error && error.name === "PasswordException" ? "cv_encrypted" : "cv_unreadable");
  });
  const pages = Array.from({ length: Math.min(pdf.numPages, MAX_PDF_PAGES) }, (_, i) => i + 1);
  const texts = await Promise.all(pages.map(async (page) => {
    const { items } = await (await pdf.getPage(page)).getTextContent();
    return items.map((item) => {
      if (!("str" in item)) return ""; // marked-content markers carry no text
      return item.hasEOL ? `${item.str}\n` : item.str;
    }).join("");
  }));
  const text = texts.join("\n");
  return { text, truncated: pdf.numPages > MAX_PDF_PAGES };
}

/** Controls and invisible characters removed, spaces collapsed per line, at most one blank line in a row. */
function tidy(text: string): string {
  return text
    .toWellFormed()
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "") // soft hyphens and zero-width characters
    .split("\n")
    .map((line) => line.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Tidied text cut to `maxText` (truncated when shortened or past the page cap), or a contract reason. */
export async function extractText(format: CvFormat, bytes: Uint8Array, maxText: number): Promise<CvWorkerResult> {
  try {
    const raw = format === "pdf" ? await pdfText(bytes) : await docxText(bytes);
    const text = tidy(raw.text);
    // Fewer than 20 letters or digits: a scan or image-only document, which this release can't read (no OCR).
    if (!/(?:[\p{L}\p{N}][^\p{L}\p{N}]*){20}/u.test(text)) throw new Failure("cv_unreadable");
    let kept = text.slice(0, maxText);
    if (/[\ud800-\udbff]$/.test(kept)) kept = kept.slice(0, -1); // never end on half a surrogate pair
    return { text: kept, truncated: raw.truncated || text.length > maxText };
  } catch (error) {
    return { failure: error instanceof Failure ? error.reason : "cv_unreadable" };
  }
}

const job = workerData as { cvParser?: true; format: CvFormat; bytes: Uint8Array; maxText: number } | null;
if (!isMainThread && job?.cvParser) {
  // Parsers warn about malformed input on the console; a CV's contents must never reach a log.
  for (const level of ["log", "info", "warn", "error", "debug", "trace"] as const) console[level] = () => {};
  parentPort!.postMessage(await extractText(job.format, job.bytes, job.maxText));
}
