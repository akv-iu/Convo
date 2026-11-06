---
title: "Folder ownership"
description: "Flag PRs that edit folders owned by the other person"
type: check
when: "A PR's head branch starts with a1/ or a2/ and it edits src/server/, src/app/api/, db/, es/ or scripts/; or its head branch starts with b1/ or b2/ and it edits src/app/(onboarding)/, src/app/(app)/ or src/components/ui/"
actions: "Add the cross-ownership label and comment listing the files outside the author's folders"
---

# Folder ownership

AGENTS.md assigns each folder to one workstream. Person A's branches are `a1/` and `a2/`; Person B's are `b1/` and `b2/`. Shared files (`src/contracts/`, `.github/`, `.gitar/`, `AGENTS.md`, root config files) are allowed from either side.

When a PR edits the other person's folders:

1. Add the `cross-ownership` label.
2. Comment with the list of files outside the author's folders and ask the owner of those folders to approve, or to make that change in their own PR instead.
