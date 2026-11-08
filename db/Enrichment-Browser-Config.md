# Browser tests with profile enrichment off and on

`playwright.config.ts` changes so the click-through gate tests both states of `PROFILE_ENRICHMENT_ENABLED`. **It's a gate change (AGENTS.md rule 6), so it needs the other person's approval before merge.**

## What changed

| | Before | After |
| --- | --- | --- |
| Servers | One: `next build && next start` on 3000 with `FAKE_API=1`. The flag was inherited from the shell. | Two from one build, both with `FAKE_API=1`: 3100 with `PROFILE_ENRICHMENT_ENABLED=0`, and 3101 with `=1`. Flags are explicit, so a shell value can't leak in. |
| Reuse | Locally, any server already on 3000 was reused, whatever its flag. | Never reused. A busy port fails the run instead of silently testing the wrong flag. |
| Projects | `phone` and `laptop` ran everything, so enrichment specs hit the flag-off server. | `phone` and `laptop` run everything except `tests/e2e/enrichment/**/*.spec.ts`. `enrichment-phone` and `enrichment-laptop` run only those specs, against 3101. |

Unchanged: the same devices, `fullyParallel`, `retries` (1 in CI, 0 locally), reporters, traces and the 180 s first-server timeout. The second server only starts, so 60 s. No new skips, retries, forced clicks or longer timeouts. CI's `npm run test:e2e` needs no change. No provider credentials are set, and the deployed feature stays off.

The flag-off check (`tests/e2e/enrichment-off.spec.ts`) sits outside `enrichment/`, so it runs on the flag-off server, as intended.

Note for local runs: free ports 3100 and 3101 first. Another session's harness uses 3240/3241, and reviewers use 3000/3001; neither collides.

## The intermittent `sources.spec.ts:275` timeout

After "Back to About you", the test checked the CV and Research switches, then tapped CV. Page 2 has the same switches in the same states, so those checks could pass against page 2 before page 1 had rendered. The tap then targeted page 2's label, which was hidden a moment later, so the click waited until the 30 s timeout (see the central test results' phone trace).

The test now waits for `/signin` and page 1's "Your name" field before using the switches. It's a test-only change: no forced click, timeout, retry or skip. The other Back step (line 215) already waited on "Your name".

## Verification (one final run)

The tree of the commit that adds this section, run with the committed config exactly as CI uses it: `CI=1 npx playwright test --workers=2 --retries=0`. It contains:
- frontend `fd1800a`;
- backend `5b3c680`;
- config `77f65b5`;
- the spec fix above.

Result: **397 passed, 13 skipped, 0 failed**, 410 cases in 5.1 minutes:
- `phone` and `laptop`: 170 cases each, flag off;
- `enrichment-phone` and `enrichment-laptop`: 35 each, flag on.

The 13 skips are the existing ones, the same count as the testing session's local harness. `sources.spec.ts:275` passed on both devices. Both servers stopped afterwards, and 3100/3101 were left free. No provider credentials, `.env.local` or live services were used. Backend unit suites weren't rerun: this change touches only the browser config and one spec.
