---
title: "Contract change needs both people"
description: "Label PRs that change the shared API contract and remind both people to approve"
type: check
when: "A PR modifies any file under src/contracts/ other than src/contracts/fixtures/"
actions: "Add the contract-change label and post the contract checklist as a comment"
---

# Contract change

`src/contracts/` is the line between Person A's screens and Person B's backend, frozen after checkpoint C0.

When a PR changes it:

1. Add the `contract-change` label.
2. Post one comment with this checklist, ticking the items the PR already satisfies:
   - [ ] `src/contracts/fake/handlers.ts` updated to match
   - [ ] `src/contracts/fake/contract.test.ts` covers the change
   - [ ] New fields are optional, or every caller sends them
   - [ ] Approved by both Person A and Person B before merge
3. If the fake or the contract test was not updated, say so plainly in the comment.
