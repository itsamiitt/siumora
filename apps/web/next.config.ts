import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, so Next compiles them itself.
  transpilePackages: ["@siumora/ui", "@siumora/core", "@siumora/in-locale"],

  images: {
    // AVIF first, WebP fallback — the PDP image budget in plan/02-frontend
    // depends on this ordering.
    formats: ["image/avif", "image/webp"],
  },

  // React Compiler is on per plan/02-frontend §1. Top-level in Next 16 —
  // it moved out of `experimental`.
  reactCompiler: true,
};

export default nextConfig;
