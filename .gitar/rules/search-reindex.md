---
title: "Search index rebuild checklist"
description: "Changing an Elasticsearch mapping means rebuilding the index, which deletes its data"
type: check
when: "A PR modifies files under es/mappings/ or es/rebuild.ts, or changes which index fields the code in src/server/search/ writes or queries"
actions: "Add the search-reindex label and post the rebuild checklist as a comment"
---

# Search index rebuild

`npm run es:rebuild` deletes and recreates the `people`, `evidence` and `asks` indices. Every indexed person, their evidence and every registered ask are gone until they are loaded again, and the deployed app shares the same cluster. Either person may run the rebuild and the seed; it doesn't need the other person's approval.

When a PR changes a mapping or the fields search reads and writes:

1. Add the `search-reindex` label.
2. Post one comment listing the changed indices and fields, and this checklist:
   - [ ] The PR description says how data gets back after the rebuild (seed script, re-registering open asks, users signing in again)
   - [ ] Field names in `es/mappings/` match the fields `src/server/search/` writes and queries
   - [ ] Any `semantic_text` field names an inference endpoint that exists on the cluster
   - [ ] The rebuild is planned outside a demo or judging slot
3. If code queries a field that no mapping defines, say so first in the comment.
