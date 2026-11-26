import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lets `npm run build` run alongside `npm run dev` without clobbering .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["three"],
};

export default nextConfig;
