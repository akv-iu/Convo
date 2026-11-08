/**
 * The people on the homepage's badge: fictional attendees with different jobs, cultures,
 * ages and looks, drawn for Lanyard as simple flat faces (original art, no photos).
 * Each face is built from a few shared parts so they stay consistent with one another.
 */
import type { ReactNode } from "react";

type Hair = "short" | "curly" | "afro" | "long" | "wavy" | "bob" | "bun" | "none";
type Head = "hijab" | "turban" | "headwrap" | "toque" | "hardhat";
type Outfit = "scrubs" | "chef" | "shirt" | "hivis" | "labcoat" | "top";

export interface HeroPerson {
  name: string;
  role: string;
  /** Badge colour behind the face (one of the badge colours). */
  badge: string;
  skin: string;
  hair: Hair;
  hairColour: string;
  head?: Head;
  headColour?: string;
  beard?: string;
  glasses?: boolean;
  freckles?: boolean;
  earrings?: boolean;
  outfit: Outfit;
  outfitColour: string;
}

export const heroPeople: HeroPerson[] = [
  { name: "Amara Okafor", role: "Nurse", badge: "#9fe3c4", skin: "#6b3e26", hair: "curly", hairColour: "#1b1410", outfit: "scrubs", outfitColour: "#1f9e8f" },
  { name: "Hiroshi Tanaka", role: "Chef", badge: "#f6d365", skin: "#ecc9a3", hair: "short", hairColour: "#1a1a1a", head: "toque", outfit: "chef", outfitColour: "#ffffff" },
  { name: "Fatima Haddad", role: "Software engineer", badge: "#c4b5fd", skin: "#c68c5a", hair: "none", hairColour: "#000", head: "hijab", headColour: "#1f6f6b", glasses: true, outfit: "top", outfitColour: "#2f3b59" },
  { name: "Gurpreet Singh", role: "Architect", badge: "#a5d8ff", skin: "#a8693f", hair: "none", hairColour: "#1c1a19", head: "turban", headColour: "#d35400", beard: "#1c1a19", outfit: "shirt", outfitColour: "#3d6fb5" },
  { name: "Sofía Ramírez", role: "Teacher", badge: "#ffa38a", skin: "#d9a066", hair: "wavy", hairColour: "#3b2219", earrings: true, outfit: "top", outfitColour: "#d35d84" },
  { name: "Liam O'Brien", role: "Site engineer", badge: "#f6d365", skin: "#f3d2b5", hair: "short", hairColour: "#b5532a", head: "hardhat", freckles: true, outfit: "hivis", outfitColour: "#f39c12" },
  { name: "Kwame Mensah", role: "Physicist", badge: "#a5d8ff", skin: "#4a2c1d", hair: "none", hairColour: "#000", beard: "#c9c9c9", glasses: true, outfit: "labcoat", outfitColour: "#2c3e50" },
  { name: "Leilani Kahale", role: "Marine biologist", badge: "#9fe3c4", skin: "#b07850", hair: "long", hairColour: "#2b1a12", outfit: "top", outfitColour: "#1f8ea3" },
  { name: "Mei Lin", role: "Product designer", badge: "#ffa38a", skin: "#f1d3b6", hair: "bob", hairColour: "#121212", outfit: "shirt", outfitColour: "#2d2d2d" },
  { name: "Zawadi Mwangi", role: "Founder", badge: "#c4b5fd", skin: "#5a3420", hair: "none", hairColour: "#000", head: "headwrap", headColour: "#e67e22", earrings: true, outfit: "top", outfitColour: "#7d3c98" },
];

const EYE = "#2a1f1a";

function backHair(p: HeroPerson): ReactNode {
  const c = p.hairColour;
  switch (p.hair) {
    case "afro":
      return <circle cx="50" cy="38" r="27" fill={c} />;
    case "long":
      return <path d="M29 42C29 22 39 15 50 15s21 7 21 27l3 34H26z" fill={c} />;
    case "wavy":
      return <path d="M28 42C28 21 39 15 50 15s22 6 22 27c0 8 4 12 3 18s-4 9-3 15H28c1-6-2-9-3-15s3-10 3-18z" fill={c} />;
    case "bob":
      return <path d="M30 46C30 24 39 17 50 17s20 7 20 29v12H30z" fill={c} />;
    case "bun":
      return <circle cx="50" cy="17" r="8" fill={c} />;
    default:
      return null;
  }
}

function frontHair(p: HeroPerson): ReactNode {
  const c = p.hairColour;
  switch (p.hair) {
    case "short":
      return <path d="M33 42c-1-15 7-22 17-22s18 7 17 22c-3-9-9-12-17-12s-14 3-17 12z" fill={c} />;
    case "curly":
      return (
        <g fill={c}>
          {[[35, 33], [40, 26], [47, 23], [54, 23], [61, 26], [66, 33], [37, 39], [64, 39]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="6" />
          ))}
        </g>
      );
    case "afro":
      return <path d="M33 40c2-9 9-13 17-13s15 4 17 13c-5-5-10-7-17-7s-12 2-17 7z" fill={c} />;
    case "long":
    case "wavy":
      return <path d="M33 42c0-14 8-21 17-21s17 7 17 21c-5-8-10-11-15-11-4 4-11 7-19 11z" fill={c} />;
    case "bob":
      return <path d="M33 38c0-10 7-16 17-16s17 6 17 16z" fill={c} />;
    case "bun":
      return <path d="M33 41c0-13 7-20 17-20s17 7 17 20c-4-7-10-10-17-10s-13 3-17 10z" fill={c} />;
    default:
      return null;
  }
}

function headwear(p: HeroPerson): { back?: ReactNode; front?: ReactNode } {
  const c = p.headColour ?? "#555";
  switch (p.head) {
    case "hijab":
      return {
        back: <path d="M25 48C25 24 37 13 50 13s25 11 25 35c0 13-5 21-9 26H34c-4-5-9-13-9-26z" fill={c} />,
        front: <path d="M34 36c3-9 9-13 16-13s13 4 16 13c-5-4-10-6-16-6s-11 2-16 6z" fill={c} />,
      };
    case "turban":
      return {
        front: (
          <g>
            <path d="M31 39c-1-16 8-25 19-25s20 9 19 25c-6-6-12-8-19-8s-13 2-19 8z" fill={c} />
            <path d="M36 30c6-5 22-9 30 1" stroke="rgba(0,0,0,0.18)" strokeWidth="2" fill="none" />
          </g>
        ),
      };
    case "headwrap":
      return {
        front: (
          <g>
            <path d="M30 38c-2-14 6-26 20-26s22 12 20 26c-6-5-13-7-20-7s-14 2-20 7z" fill={c} />
            <path d="M44 13c4-6 12-6 14 0-4 1-9 3-14 0z" fill={c} />
            <path d="M34 27h32M33 33h34" stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" />
          </g>
        ),
      };
    case "toque":
      return {
        front: (
          <g fill="#ffffff" stroke="rgba(0,0,0,0.12)" strokeWidth="1">
            <circle cx="40" cy="14" r="8" />
            <circle cx="50" cy="10" r="9" />
            <circle cx="60" cy="14" r="8" />
            <rect x="35" y="16" width="30" height="16" rx="2" />
          </g>
        ),
      };
    case "hardhat":
      return {
        front: (
          <g>
            <path d="M31 33c0-12 8-19 19-19s19 7 19 19z" fill="#f4c20d" />
            <rect x="27" y="31" width="46" height="5" rx="2.5" fill="#e0ae00" />
            <path d="M50 14v17" stroke="#e0ae00" strokeWidth="3" />
          </g>
        ),
      };
    default:
      return {};
  }
}

function outfit(p: HeroPerson): ReactNode {
  const body = "M12 100c2-20 18-29 38-29s36 9 38 29z";
  switch (p.outfit) {
    case "scrubs":
      return (
        <g>
          <path d={body} fill={p.outfitColour} />
          <path d="M42 72l8 10 8-10" stroke={p.skin} strokeWidth="5" fill={p.skin} />
        </g>
      );
    case "chef":
      return (
        <g>
          <path d={body} fill="#ffffff" stroke="rgba(0,0,0,0.12)" />
          {[84, 92].map((y) => [44, 56].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="#9aa5b1" />))}
        </g>
      );
    case "hivis":
      return (
        <g>
          <path d={body} fill={p.outfitColour} />
          <rect x="14" y="88" width="72" height="4" fill="#e9eef2" />
        </g>
      );
    case "labcoat":
      return (
        <g>
          <path d={body} fill="#f4f6f8" stroke="rgba(0,0,0,0.12)" />
          <path d="M43 72l7 28 7-28z" fill={p.outfitColour} />
        </g>
      );
    case "shirt":
      return (
        <g>
          <path d={body} fill={p.outfitColour} />
          <path d="M42 71l8 7-4 5zM58 71l-8 7 4 5z" fill="#ffffff" />
        </g>
      );
    default:
      return <path d={body} fill={p.outfitColour} />;
  }
}

/** One attendee's face on their badge colour, filling its box. Decorative. */
export function HeroFace({ person: p, className = "" }: { person: HeroPerson; className?: string }) {
  const wear = headwear(p);
  const covered = p.head === "hijab";
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" className={`overflow-hidden rounded-full ${className}`}>
      <g>
        <rect width="100" height="100" fill={p.badge} />
        {wear.back}
        {!covered && backHair(p)}
        {outfit(p)}
        <rect x="44" y="58" width="12" height="13" rx="4" fill={p.skin} />
        {!covered && (
          <>
            <circle cx="32.5" cy="46" r="3.6" fill={p.skin} />
            <circle cx="67.5" cy="46" r="3.6" fill={p.skin} />
          </>
        )}
        <ellipse cx="50" cy="45" rx={covered ? 15 : 17} ry={covered ? 18 : 20} fill={p.skin} />
        {p.earrings && !covered && (
          <>
            <circle cx="32" cy="52" r="1.8" fill="#f1c40f" />
            <circle cx="68" cy="52" r="1.8" fill="#f1c40f" />
          </>
        )}
        {p.beard && <path d="M34 47c0 14 7 21 16 21s16-7 16-21c-4 7-9 9-16 9s-12-2-16-9z" fill={p.beard} />}
        {p.beard && <path d="M43 55c3-2 11-2 14 0-3 2-11 2-14 0z" fill={p.beard} />}
        {!covered && frontHair(p)}
        {wear.front}
        <path d="M40 40.5c2-1.6 5-1.6 7 0M53 40.5c2-1.6 5-1.6 7 0" stroke={EYE} strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.7" />
        <circle cx="43.5" cy="45" r="1.9" fill={EYE} />
        <circle cx="56.5" cy="45" r="1.9" fill={EYE} />
        {p.glasses && (
          <g stroke="#1f1f1f" strokeWidth="1.5" fill="none">
            <circle cx="43.5" cy="45" r="5" />
            <circle cx="56.5" cy="45" r="5" />
            <path d="M48.5 45h3" />
          </g>
        )}
        {p.freckles && (
          <g fill="#c7835a" opacity="0.7">
            {[[40, 50], [42, 52], [44, 50], [56, 50], [58, 52], [60, 50]].map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="0.8" />
            ))}
          </g>
        )}
        <path d="M44.5 53.5q5.5 4 11 0" stroke={EYE} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}
