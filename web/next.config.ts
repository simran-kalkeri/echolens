import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  // lets `npm run build` run alongside `npm run dev` without clobbering .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["three"],
  ...(isGitHubPages
    ? {
        output: "export",
        basePath: "/enterpret",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
