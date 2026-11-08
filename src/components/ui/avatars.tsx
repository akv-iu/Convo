/**
 * The built-in badge pictures (Person.avatar): twelve simple, original shapes drawn for Lanyard
 * on a 24 × 24 grid, in the badge's ink colour on its badge colour. No copied or licensed art,
 * and no GitHub photos (demo handles may belong to real people).
 */
import type { CSSProperties, ReactNode } from "react";
import type { AvatarId } from "@/contracts/types";

const fill = { fill: "currentColor" } as const;
const line = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const avatars: readonly { id: AvatarId; name: string; art: ReactNode }[] = [
  { id: "star", name: "Star", art: <path {...fill} d="M12 2.5l2.9 6.1 6.6.7-4.9 4.5 1.4 6.5L12 17l-6 3.3 1.4-6.5-4.9-4.5 6.6-.7z" /> },
  { id: "moon", name: "Moon", art: <path {...fill} d="M14.5 3A9 9 0 1 0 21 17.5 7.5 7.5 0 0 1 14.5 3z" /> },
  {
    id: "sun",
    name: "Sun",
    art: (
      <>
        <circle {...fill} cx="12" cy="12" r="4.5" />
        <path {...line} d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
      </>
    ),
  },
  {
    id: "leaf",
    name: "Leaf",
    art: (
      <>
        <path {...fill} d="M4 20C4 10 9.5 4.5 20 4c-.5 10.5-6 16-16 16z" />
        <path {...line} stroke="var(--badge)" d="M4.5 19.5L14 10" />
      </>
    ),
  },
  { id: "wave", name: "Wave", art: <path {...line} strokeWidth={2.5} d="M2 10c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1M2 16c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1" /> },
  { id: "peak", name: "Peaks", art: <path {...fill} d="M1.5 20L9 7l4.2 7.3L16 10l6.5 10z" /> },
  { id: "bolt", name: "Bolt", art: <path {...fill} d="M13.5 2L4 14h7l-1 8 10-12.5h-7z" /> },
  { id: "heart", name: "Heart", art: <path {...fill} d="M12 20.5S3.5 15.3 3.5 9.3A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8.5 2.4c0 6-8.5 11.2-8.5 11.2z" /> },
  {
    id: "flower",
    name: "Flower",
    art: (
      <>
        <circle {...fill} cx="12" cy="6.5" r="3.5" />
        <circle {...fill} cx="12" cy="17.5" r="3.5" />
        <circle {...fill} cx="6.5" cy="12" r="3.5" />
        <circle {...fill} cx="17.5" cy="12" r="3.5" />
        <circle cx="12" cy="12" r="2.5" fill="var(--badge)" />
      </>
    ),
  },
  { id: "cloud", name: "Cloud", art: <path {...fill} d="M7 19h10.5a4.5 4.5 0 0 0 .4-9A6.5 6.5 0 0 0 5.6 11.2 4 4 0 0 0 7 19z" /> },
  {
    id: "gem",
    name: "Gem",
    art: (
      <>
        <path {...fill} d="M6.5 3.5h11L22 9l-10 12L2 9z" />
        <path {...line} stroke="var(--badge)" strokeWidth={1.5} d="M2.5 9h19M9 3.5L7.5 9 12 20.5 16.5 9 15 3.5" />
      </>
    ),
  },
  { id: "spark", name: "Spark", art: <path {...fill} d="M12 1.5c.7 6 2.6 8.4 9.5 10.5-6.9 2.1-8.8 4.5-9.5 10.5-.7-6-2.6-8.4-9.5-10.5C9.4 9.9 11.3 7.5 12 1.5z" /> },
];

/** Up to two initials from a name ("Ada Lovelace" → "AL"), for someone without a picture. */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => Array.from(word)[0] ?? "");
  const picked = letters.length > 1 ? [letters[0], letters[letters.length - 1]] : letters;
  return picked.join("").toLocaleUpperCase() || "?";
}

/**
 * A person's badge picture: their chosen shape, or their initials, on their badge colour.
 * Decorative (aria-hidden), since their name is always shown next to it. `colour` overrides
 * the person's colour (onboarding previews the picker's choice through --badge).
 */
export function Avatar({
  avatar,
  name,
  className = "size-10",
  colour,
}: {
  avatar: AvatarId | null | undefined;
  name: string;
  /** Size (and any extra) classes; the text scales with it. */
  className?: string;
  /** A CSS colour for the background; defaults to var(--badge) from the surrounding element. */
  colour?: string;
}) {
  const art = avatar ? avatars.find((a) => a.id === avatar)?.art : undefined;
  const style = colour ? ({ "--badge": colour } as CSSProperties) : undefined;
  return (
    <span
      aria-hidden="true"
      data-avatar={avatar ?? "initials"}
      style={style}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--badge)] text-[var(--badge-ink)] [container-type:inline-size] ${className}`}
    >
      {art ? (
        <svg viewBox="0 0 24 24" className="size-[62%]" focusable="false">
          {art}
        </svg>
      ) : (
        <span className="text-[40cqw] font-extrabold leading-none tracking-tight">{initials(name)}</span>
      )}
    </span>
  );
}
