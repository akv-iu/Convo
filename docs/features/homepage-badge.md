# Feature: Homepage badge animation

Owner: Person A · PRs: the first PR of this feature

## What it covers

- [x] **Screens:**
  - **The animation:** the homepage shows a badge on a lanyard, like the logo, beside the pitch, or below it on phones. Faces of fictional attendees flick past, then slow down and settle on one, marked "Your match".
  - **The people:** a range of jobs (nurse, chef, software engineer, architect, teacher, site engineer, physicist, marine biologist, product designer, founder), cultures, ages and looks.
  - **The art:** original flat illustrations (`src/components/ui/hero-faces.tsx`), not photos.
  - **Behaviour:** it plays once per visit. With reduced motion it shows the chosen person straight away, without swaying. It's decorative (`aria-hidden`), since the page's text says what Lanyard does.
- [x] **Docs:** this file.

## How to try it

1. Open `/`. After a moment the badge flicks through faces, slows, and settles on one with "✓ Your match".
2. Reload: it settles on a different person each time.
3. Turn on "reduce motion" in your system settings and reload: the badge shows one person at once, still.
4. On a phone-width window the badge sits below the pitch, with no sideways scrolling.

## Not covered

- Real attendees' photos, on purpose: these are fictional people.
- Replaying the animation without a reload.
