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

## Verification

See the report for the exact commits and the single full-matrix run made with this committed config.
