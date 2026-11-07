import type { MetadataRoute } from "next";

/** Installable web app: one codebase for phone, tablet and laptop. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lanyard",
    short_name: "Lanyard",
    description: "Outcome-driven networking for conferences.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
    ],
  };
}
