# Screens (`src/app/(onboarding)/`, `src/app/(app)/`, `src/components/ui/`)

- Server components by default; `"use client"` only where there is interaction. Flag a whole page marked client for one button.
- Use the tokens in `src/app/globals.css` and the components in `src/components/ui/`. Flag raw hex or rgb colours and Tailwind arbitrary colour values.
- Treat as a blocking issue: an interactive element that cannot be reached or used with the keyboard, an input without an accessible name, or an icon-only button without `aria-label`. Accessibility is a judged prize track.
- Flag text or badge colours that may fall below WCAG AA contrast.
- Every screen that loads data handles loading, empty and error states. A failed request is an error, never an empty list.
- Forms that load saved data: a response that arrives after the user started typing must not overwrite their edits, and a failed save must leave the form able to retry the same save (these bugs were found in earlier Convo reviews).
- Saved state comes from the API (`GET /api/me` and friends), not from cookies or local storage; a cookie may only cache it for the next page load.
- `person.filters.country` and `person.filters.hiring` on match cards can be `null`, meaning hidden by that person. Flag code that shows `null` hiring as "not hiring".
- Synthetic profiles must show the "synthetic" label.
