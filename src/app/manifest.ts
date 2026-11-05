import type { MetadataRoute } from "next";

/** Installable web app: one codebase for phone, tablet and laptop. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Convo",
    short_name: "Convo",
    description: "Outcome-driven networking for conferences.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
