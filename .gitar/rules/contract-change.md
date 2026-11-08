---
title: "Contract change checklist"
description: "Label PRs that change the shared API contract and check that the fake, the contract test and every caller changed with it"
type: check
when: "A PR modifies any file under src/contracts/ other than src/contracts/fixtures/"
actions: "Add the contract-change label and post the contract checklist as a comment"
---

# Contract change

`src/contracts/` is the line between the screens and the backend. Either person may change it, as long as everything that depends on it changes in the same PR.

When a PR changes it:

1. Add the `contract-change` label.
2. Post one comment with this checklist, ticking the items the PR already satisfies:
   - [ ] `src/contracts/fake/handlers.ts` updated to match
   - [ ] `src/contracts/fake/contract.test.ts` covers the change
   - [ ] The real handler and every screen that uses the route or type updated in this PR
   - [ ] New fields are optional, or every caller sends them
3. If the change is breaking (a route or field removed or renamed, a field made required, or a status code or meaning changed), say so first: it needs the other person's approval (see the needs-approval rule).
4. If the fake or the contract test was not updated, say so plainly in the comment.
