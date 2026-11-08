# CV text extraction

Status: parser-only work on `b/enrichment-cv-parser`, based on `b/enrichment-github` `9b143a4`. No route, contract, configuration, environment value, job, storage, synthesis, approval, migration, screen or package file changes. **It needs two dependencies that Codex adds** (below); until then this branch's typecheck and tests fail in CI. The eventual PR targets main after its dependencies merge.

Integration update: `b/enrichment-cv-dependencies` combines parser `3391a02` with approved storage `1380e70` and exact-pins both requested libraries in `package.json`/`package-lock.json`. Use that integrated dependency branch for checks; the original provider-only branch intentionally has no package edits. Upload routing and synthesis remain unwired.

Integration verification: clean `npm ci`, lint/typecheck twice, and two complete `npm test -- --coverage --maxWorkers=2` runs passed on Node 24.21.0: 1,036 tests in 69 files, 98.48% line coverage. Existing locked package versions are unchanged; the additions are the two parsers and their transitive dependencies. Binary-fixture coverage parse warnings remain non-fatal; shared coverage settings were not changed. No Node 22, Vercel upload, browser or live provider test was run here.

To repeat locally: use Node 22.18+ on the supported 22 line or Node 24, check out the integrated branch in an isolated worktree, run `npm ci`, `npm run lint`, `npm run typecheck`, then `npm test -- --coverage --maxWorkers=2`. Expected: all checks pass; fixture warnings may print. No credentials are needed, no server is started, and no data cleanup is required. Do not install into a worktree whose `node_modules` is a junction to another checkout.

Codex keeps authenticated upload, consent and ownership checks, private storage, expiry and cleanup, contact-data scrubbing, synthesis, approval, routes and migrations.

## Interface

`src/server/profile/enrichment/cv-parser.ts` exports `extractCvText(bytes: Uint8Array)`. It returns `{ text, warnings }`:

- `text`: plain text, at most `MAX_SOURCE_TEXT` (30,000) characters.
- `warnings`: `["cv_truncated"]` when anything was left out, else `[]`.

It throws the shared sanitized `StateError`. The statuses match the upload adapter:

| Code | Status | When |
| --- | --- | --- |
| `cv_too_large` | 413 | More than `MAX_CV_BYTES` (2 MiB). Checked before anything else. |
| `cv_unsupported` | 415 | Not a PDF or DOCX by its own bytes: images, legacy `.doc`, other ZIP formats (ODT, XLSX, PPTX), empty files. |
| `cv_encrypted` | 422 | A PDF that needs a password to open; a password-protected Word file; a ZIP with encrypted entries. |
| `cv_unreadable` | 422 | Malformed or cut-off files; scans and image-only documents (fewer than 20 letters or digits; no OCR); anything that hits a parsing limit. |
| `unknown` | 500 | The parser couldn't run at all (for example, a broken deployment). This is the server's fault, so it is never reported as an unreadable file. |

How the upload route uses it:

1. Read the file part into bytes.
2. Call `extractCvText`.
3. Stage `text` privately, with `characters: text.length`, `filename` and `warnings` in `CvUpload`.
4. Discard the bytes.

`stageCvText` currently takes only pasted text, so the file path needs a sibling that accepts this result. The parser keeps no copy: its worker's copy disappears when the worker is terminated.

**Unchanged for the caller:** pasted text keeps its explicit 30,000-character validation (`invalid_input`); it isn't truncated. Contact-data scrubbing happens after extraction and before model input, and is Codex's work.

## Format detection

The file's own signature decides; its name and declared MIME type are ignored.

- **PDF:** `%PDF-` within the first 1 KiB, where PDF readers accept it.
- **DOCX:** starts with a ZIP local-file header, and the ZIP contains `[Content_Types].xml` and `word/document.xml`.
- **OLE compound file:** an `EncryptedPackage` stream means Office's password-protected `.docx` (`cv_encrypted`). Otherwise it's a legacy `.doc` (`cv_unsupported`).

## Isolation and limits

Parsing runs in a `worker_threads` worker (`cv-worker.mts`), one per CV. The worker is terminated afterwards and whenever a limit is hit; `terminate()` stops running JavaScript, so a stuck parser is not merely abandoned. The worker gets:

- its own copy of the bytes, made with `new Uint8Array(bytes)` and transferred. A Node `Buffer` works too: its `slice()` would share pooled memory, so it isn't used;
- an empty environment;
- console methods that do nothing;
- captured and discarded stdout and stderr.

Parser warnings and errors therefore never reach the server log. Only a contract reason or tidied text comes back.

| Limit | Value | Result |
| --- | --- | --- |
| Deadline | 8 s per parse | Terminated → `cv_unreadable` |
| V8 heap (`resourceLimits`) | 128 MiB old generation, 16 MiB young, 4 MiB stack | `ERR_WORKER_OUT_OF_MEMORY` → `cv_unreadable`; the process keeps running |
| Process memory growth (RSS, checked every 20 ms) | 384 MiB above the start | Terminated → `cv_unreadable`. This catches decoded PDF streams, which live outside the V8 heap. |
| Parsers at once | 2 per process; later uploads wait | Bounds total memory; the RSS allowance covers both slots |
| PDF pages | First 20 | `cv_truncated` |
| Extracted text | First 30,000 characters (never half a surrogate pair) | `cv_truncated` |
| DOCX entries | 500 | `cv_unreadable` |
| DOCX expansion | 20 MiB, all parts together | `cv_unreadable` |

Notes on the limits:

- The deadline counts from the worker's start, not from any time spent waiting for a slot.
- **DOCX expansion is checked before Mammoth runs.** Each central-directory entry is decompressed with `inflateRawSync`, using `maxOutputLength` set to its declared size. An entry that claims to be small but inflates further is stopped at that size (no full expansion), and must match its declared size exactly.
- **The end record must account for every entry.** JSZip lists every consecutive central-directory record, whatever the end record's count says. So the count and directory size must cover exactly the records up to the end record, on a single disk. Otherwise, extra records could slip past the check unexamined.
- Other DOCX rejections: ZIP64, multi-disk archives and compression methods other than stored or deflate. JSZip then only re-reads parts already proven bounded.

Libraries:

- **unpdf 1.9.1** (pdf.js 6.4 serverless build): `verbosity: 0`, no system fonts or font faces, no XFA, `maxImageSize` 16 MP. Text comes from `getTextContent` per page. A PDF with only an owner password (copy or print restrictions) still opens. A user password gives `cv_encrypted`.
- **Mammoth 1.13.0** `extractRawText`. External file references stay unread (`externalFileAccess` defaults to false). No HTML is produced or rendered.

**Tidying.** Lone surrogates are made well-formed. Soft hyphens and zero-width characters are removed. Control characters become spaces, runs of spaces collapse, and lines are trimmed. At most one blank line is kept in a row.

## Dependencies and deployment

**Dependency request to Codex.** Add exact-pinned `"unpdf": "1.9.1"` and `"mammoth": "1.13.0"` to `dependencies` (`npm install --save-exact unpdf@1.9.1 mammoth@1.13.0`). Nothing else changes.

The integrated package also raises the Node minimum to 22.18.0. unpdf requires Node 22+, and the direct `.mts` worker needs default TypeScript stripping (enabled in Node 22.18.0; see [Node's documentation](https://nodejs.org/api/typescript.html)). CI already uses Node 22. Configure Vercel to a supported Node 22 or 24 runtime before live acceptance; no deployment setting was changed here.

- unpdf 2.x requires Node 24, and its latest release is newer than the two-week minimum age. unpdf 1.9.1 documents Node 22+, so the Vercel project must run Node 22 or 24.
- Mammoth pulls in jszip, @xmldom/xmldom, lop, underscore, xmlbuilder, base64-js, dingbat-to-unicode and argparse.

**No `next.config` change is needed.** A local `next build` (Turbopack, Next 16.4.5) recognised `new Worker(new URL("./cv-worker.mts", import.meta.url))` and emitted it as a bundled worker-thread chunk. `next start` then returned the expected result for each of 12 fixtures (text, truncation, encrypted, scanned, expansion, heap, memory and unsupported), through a temporary route that was not committed. The server log contained no document text. Vercel itself was not tested, so a Preview deployment should repeat one PDF and one DOCX upload once Codex wires the route.

**Coverage config request to Codex (optional).** Add `"src/**/fixtures/**"` to `coverage.exclude` in `vitest.config.mts`. Coverage currently tries to parse every fixture under `src/server/` (the binary CV files and the public-profile HTML) and prints a harmless warning for each.

## Fixtures and tests

`fixtures/cv/` holds small real documents. Each was made by `make-fixtures.py` (standard-library Python) and opens in ordinary readers; the person in them is fictional.

- **Text documents:** PDF and DOCX.
- **Truncation:** a 20-page PDF over 30,000 characters, and a 22-page PDF.
- **Encrypted:** an RC4-encrypted PDF (user password); a ZIP with an encrypted entry; an OLE `EncryptedPackage` stand-in for a password-protected Word file.
- **Unreadable:** an image-only (scanned) PDF, an empty DOCX, a malformed PDF, and a messy DOCX for tidying.
- **Expansion limits:** an honest 21 MiB expansion, a lying entry (declares 4 KiB, inflates to 5 MiB), and 1,000 entries.
- **Miscounted end records:** 500 parts and a lying part hidden behind an end record that claims 3 entries, with and without a matching shrunk directory size.
- **Memory limits:** a DOCX with 14 MiB of paragraphs, which exceeds the worker heap; and a 0.5 MB PDF whose content stream decodes to 512 MiB, which trips the memory watchdog or the deadline.
- **Unsupported:** a legacy `.doc`, an ODT-style ZIP and a PNG.

Word was not used: automating it stalled on a hidden dialog, and the Word instance this session started was closed.

`cv-parser.test.ts` covers:

- every fixture through the real worker;
- each limit with real documents (deadline, heap, memory growth);
- recovery after a terminated parser;
- two parsers at most at once;
- a worker that cannot load being reported as `unknown`/500;
- the caller's bytes left unchanged, including pooled and standalone Node Buffers;
- no console, stdout or stderr output.

The worker's own functions also run in-process, for coverage.

## Limitations

- No OCR: scanned CVs must be pasted as text.
- CJK fonts that need pdf.js character maps (`cMapUrl`) are not bundled, so such text may come out garbled or empty; it was not tested.
- Reading order follows the PDF's content stream. Multi-column layouts may interleave columns.
- The memory watchdog reads process-wide RSS. Unrelated allocations elsewhere in the process during a parse count against it. The 384 MiB margin is generous, but a busy instance could reject a heavy but valid CV.
- The wait for a parser slot has no limit of its own. Each turn ends within the 8 s deadline, and the owner's upload rate limit applies.
- Old `.doc`, `.odt`, `.rtf` and `.pages` files are out of scope (`cv_unsupported`).

No live service, upload or real person's document was used.
