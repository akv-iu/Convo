import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // No Next.js "N" badge in the corner during demos and screenshots; build errors still show.
  devIndicators: false,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
