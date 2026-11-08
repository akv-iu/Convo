---
title: "New environment variable checklist"
description: "A setting the deployed app does not have yet breaks production after merge"
type: check
when: "A PR adds code that reads a process.env variable not read anywhere before, or adds a key to .env.example"
actions: "Add the env-change label and post the deployment checklist as a comment"
---

# New environment variable

Vercel deploys `main` straight to production, and the deployed app only has the variables someone set by hand.

When a PR starts reading a new variable:

1. Add the `env-change` label.
2. Post one comment naming each new variable and where it is read, and this checklist:
   - [ ] Listed in `.env.example` with an empty value or a safe default, never a real secret
   - [ ] Set in Vercel for Production and Preview before this PR merges. Only Person B (akv-iu) can set it: if someone else opened the PR, they ask Person B, and the PR needs B's approval (see the needs-approval rule)
   - [ ] If it is a switch like `FAKE_API` or `FAKES`, it is read only in `src/server/config.ts`
   - [ ] The code fails with a clear message when it is missing, rather than calling a service with `undefined`
3. If a variable is read in code but missing from `.env.example`, say so first in the comment.
