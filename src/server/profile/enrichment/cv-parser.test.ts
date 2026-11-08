import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { MAX_CV_BYTES, MAX_SOURCE_TEXT } from "@/contracts/enrichment";
import { CV_LIMITS, extractCvText } from "./cv-parser";
import { extractText } from "./cv-worker.mjs";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/cv/${name}`, import.meta.url)));

describe("extractCvText", () => {
  it("extracts a text-based PDF", async () => {
    const { text, warnings } = await extractCvText(fixture("text.pdf"));
    expect(text).toContain("Ada Example");
    expect(text).toContain("2021-2026 Example University: built data pipelines");
    expect(text.split("\n")).toContain("Skills");
    expect(warnings).toEqual([]);
  });

  it("extracts a DOCX, one paragraph per line", async () => {
    const { text, warnings } = await extractCvText(fixture("text.docx"));
    expect(text.split("\n").filter(Boolean)).toEqual(expect.arrayContaining(["Ada Example", "Python, Rust, numerical methods, reproducible research"]));
    expect(text).not.toMatch(/\n{3}/);
    expect(warnings).toEqual([]);
  });

  it("detects the format from the bytes, not the caller, and leaves the caller's bytes intact", async () => {
    const bytes = fixture("text.docx");
    const copy = bytes.slice();
    await extractCvText(bytes);
    expect(bytes).toEqual(copy);
  });

  it("keeps the first 30,000 characters and reports cv_truncated", async () => {
    const { text, warnings } = await extractCvText(fixture("long.pdf"));
    expect(text).toHaveLength(MAX_SOURCE_TEXT);
    expect(text.startsWith("1.1 Led a reproducible-research workshop")).toBe(true);
    expect(warnings).toEqual(["cv_truncated"]);
  });

  it("reads at most 20 PDF pages and reports cv_truncated", async () => {
    const { text, warnings } = await extractCvText(fixture("many-pages.pdf"));
    expect(text).toContain("Page 20 of");
    expect(text).not.toContain("Page 21 of");
    expect(warnings).toEqual(["cv_truncated"]);
  });

  it.each([
    ["image.png", "cv_unsupported", 415],
    ["legacy.doc", "cv_unsupported", 415],
    ["not-docx.zip", "cv_unsupported", 415],
    ["office-encrypted.docx", "cv_encrypted", 422],
    ["encrypted.pdf", "cv_encrypted", 422],
    ["encrypted-entry.docx", "cv_encrypted", 422],
    ["scanned.pdf", "cv_unreadable", 422],
    ["image-only.docx", "cv_unreadable", 422],
    ["malformed.pdf", "cv_unreadable", 422],
    ["many-entries.docx", "cv_unreadable", 422],
  ])("rejects %s honestly as %s", async (name, code, status) => {
    await expect(extractCvText(fixture(name))).rejects.toMatchObject({ code, status });
  });

  it("rejects an empty or oversized file before parsing", async () => {
    await expect(extractCvText(new Uint8Array(0))).rejects.toMatchObject({ code: "cv_unsupported", status: 415 });
    const big = new Uint8Array(MAX_CV_BYTES + 1);
    big.set(fixture("text.pdf"));
    await expect(extractCvText(big)).rejects.toMatchObject({ code: "cv_too_large", status: 413 });
  });

  it("refuses a DOCX whose parts would expand past the limit, before Mammoth reads them", async () => {
    // 21 MiB of text compressed to 22 KB, honestly declared.
    await expect(extractCvText(fixture("bomb.docx"))).rejects.toMatchObject({ code: "cv_unreadable" });
    // Declares 4 KiB but inflates to 5 MiB: stopped at the declared size, never fully expanded.
    await expect(extractCvText(fixture("lying.docx"))).rejects.toMatchObject({ code: "cv_unreadable" });
  });

  it("kills a parser that outgrows its memory allowance", async () => {
    // 512 MiB of PDF content in a 0.5 MB file; the memory watchdog stops it long before the deadline.
    const started = Date.now();
    await expect(extractCvText(fixture("bomb.pdf"), { ...CV_LIMITS, timeoutMs: 60_000, growthMb: 64 })).rejects.toMatchObject({ code: "cv_unreadable" });
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);

  it("kills a parser that runs past its deadline, and the next parse still works", async () => {
    const started = Date.now();
    await expect(extractCvText(fixture("bomb.pdf"), { ...CV_LIMITS, timeoutMs: 300, growthMb: 4096 })).rejects.toMatchObject({ code: "cv_unreadable" });
    expect(Date.now() - started).toBeLessThan(5_000);
    await expect(extractCvText(fixture("text.pdf"))).resolves.toMatchObject({ warnings: [] });
  }, 30_000);

  it("stops a parser that exceeds its heap limit, without taking the process down", async () => {
    // 14 MiB of paragraphs (inside the expansion budget) builds an XML tree larger than the worker's heap.
    await expect(extractCvText(fixture("large.docx"))).rejects.toMatchObject({ code: "cv_unreadable" });
    await expect(extractCvText(fixture("text.docx"))).resolves.toMatchObject({ warnings: [] });
  }, 30_000);

  it("reports a worker that can't run as a server fault, not an unreadable file", async () => {
    // A real worker whose script fails to load, as a bad deployment would.
    vi.resetModules();
    vi.doMock("node:worker_threads", async (original) => {
      const real = await original<typeof import("node:worker_threads")>();
      class Unloadable extends real.Worker {
        constructor(_script: URL, options: import("node:worker_threads").WorkerOptions) {
          super(new URL("data:text/javascript,throw new Error('missing')"), options);
        }
      }
      return { ...real, Worker: Unloadable };
    });
    try {
      const { extractCvText: broken } = await import("./cv-parser");
      await expect(broken(fixture("text.pdf"))).rejects.toMatchObject({ code: "unknown", status: 500 });
    } finally {
      vi.doUnmock("node:worker_threads");
      vi.resetModules();
    }
  }, 30_000);

  it("runs at most two parsers at a time; the rest wait their turn", async () => {
    let live = 0;
    let most = 0;
    vi.resetModules();
    vi.doMock("node:worker_threads", async (original) => {
      const real = await original<typeof import("node:worker_threads")>();
      class Counted extends real.Worker {
        constructor(script: URL, options: import("node:worker_threads").WorkerOptions) {
          super(script, options);
          most = Math.max(most, ++live);
          this.once("exit", () => live--);
        }
      }
      return { ...real, Worker: Counted };
    });
    try {
      const { extractCvText: counted } = await import("./cv-parser");
      const results = await Promise.all(["text.pdf", "text.docx", "malformed.pdf", "text.pdf", "scanned.pdf"].map((name) => counted(fixture(name)).then(() => "ok", (e: { code: string }) => e.code)));
      expect(results).toEqual(["ok", "ok", "cv_unreadable", "ok", "cv_unreadable"]);
      expect(most).toBe(2);
    } finally {
      vi.doUnmock("node:worker_threads");
      vi.resetModules();
    }
  }, 60_000);

  it("writes nothing to the console, even for documents that fail", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");
    try {
      await extractCvText(fixture("text.pdf"));
      await extractCvText(fixture("malformed.pdf")).catch(() => {});
      await extractCvText(fixture("scanned.pdf")).catch(() => {});
      for (const spy of [...spies, stdout, stderr]) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of [...spies, stdout, stderr]) spy.mockRestore();
    }
  }, 30_000);
});

// The worker's own code, run in this process so its branches are covered. Only documents that stay small
// here: the heap and memory-growth cases need the worker's limits (above).
describe("extractText (worker code, in-process)", () => {
  it.each([
    ["text.pdf", "pdf", { truncated: false }],
    ["text.docx", "docx", { truncated: false }],
    ["long.pdf", "pdf", { truncated: true }],
    ["many-pages.pdf", "pdf", { truncated: true }],
    ["encrypted.pdf", "pdf", { failure: "cv_encrypted" }],
    ["encrypted-entry.docx", "docx", { failure: "cv_encrypted" }],
    ["not-docx.zip", "docx", { failure: "cv_unsupported" }],
    ["scanned.pdf", "pdf", { failure: "cv_unreadable" }],
    ["malformed.pdf", "pdf", { failure: "cv_unreadable" }],
    ["image-only.docx", "docx", { failure: "cv_unreadable" }],
    ["many-entries.docx", "docx", { failure: "cv_unreadable" }],
    ["bomb.docx", "docx", { failure: "cv_unreadable" }],
    ["lying.docx", "docx", { failure: "cv_unreadable" }],
  ] as const)("%s", async (name, format, expected) => {
    expect(await extractText(format, fixture(name), MAX_SOURCE_TEXT)).toMatchObject(expected);
  });

  it("treats a cut-off or corrupted ZIP as unreadable, never as a crash", async () => {
    const docx = fixture("text.docx");
    for (const broken of [docx.subarray(0, docx.length - 10), docx.subarray(0, 600), Uint8Array.from(docx).fill(0, 40, 120)]) {
      expect(await extractText("docx", broken, MAX_SOURCE_TEXT)).toEqual({ failure: "cv_unreadable" });
    }
  });

  it("tidies text: invisible characters out, spaces collapsed, at most one blank line", async () => {
    expect(await extractText("docx", fixture("messy.docx"), MAX_SOURCE_TEXT)).toEqual({
      text: ["AdaExample", "cooperative research lead", "Skills", "PythonPythonPython"].join("\n\n"), truncated: false,
    });
  });
});
