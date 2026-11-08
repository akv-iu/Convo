# Feature: Default avatars

Owner: Person A · PRs: #50

## What it covers

- [x] **Screens:**
  - Step 2: a "+" on the badge's picture opens a "Your picture" group: Initials plus twelve built-in pictures. It closes with Done or Escape, and focus returns to the "+". The choice is saved with Continue.
  - The picture, or the person's initials on their badge colour, shows on the badge (steps 2 to 4), the step 4 "How people see you" row, match rows and open profiles, and the request badges in Requests.
- [x] **Contract:** `AvatarId` and an optional, nullable `Person.avatar`, saved through `PUT /api/me`. It's always shown, not a show/hide section. The fake and `contract.test.ts` are updated.
- [x] **Backend:** a `users.avatar` column, carried through `toPerson`, `writeUser` and the search index's stored person. An unknown stored value is refused (503).
- [ ] **Data:** migration `0006_default_avatars.sql` (one nullable column, additive) applied to Neon before the deployed app runs this code.
- [x] **Tests:**
  - **Unit:** the profile service, visibility, answers, initials and art.
  - **Contract.**
  - **Playwright:** the step 2 picker by tap and keyboard, and pictures on match rows and profiles.
  - **Axe:** with the picker open, in light and dark.
- [x] **Docs:** `db/Frontend-Support.md`.

## How to try it

1. Open step 2 (`/onboarding`). Expect the badge to show your initials on the badge colour.
2. Press the **+** on the picture. A grid of Initials plus twelve pictures opens below the badge, with the current choice focused.
3. Pick **Moon**: the badge shows a moon. Pick another badge colour: the picture follows it. Press **Done**.
4. Press **Continue**. Steps 3 and 4 show the moon on your badge, and step 4's "How people see you" row shows it too.
5. In someone else's matches, or in Requests when you've sent them a question, your row and badge show the moon. Synthetic people show initials.

## Not covered

- Photo uploads, which come later as a separate field with storage, an image check, location data removed, and size and type limits.
- GitHub photos, because demo handles may belong to real people.
