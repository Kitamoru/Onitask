import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── Rendering strategy for Telegram Web App ──────────────────────────
  // TWA apps are fully client-driven: Telegram SDK (window.Telegram)
  // doesn't exist on server, so we avoid full SSR.
  //
  // Best practice: CSR shell + streaming Suspense for data fetches.
  // Auth routes must NOT use ISR (Set-Cookie caching issues).
  experimental: {
    // Optimize bundle size by tree-shaking these packages
    optimizePackageImports: [
      '@supabase/ssr',
      '@supabase/supabase-js',
      'lucide-react',
    ],
  },
  // ESLint is broken in this repo: @rushstack/eslint-patch is incompatible
  // with ESLint 9.39.0 ("Failed to patch ESLint because the calling module
  // was not recognized"), which fails `next build` during the lint phase.
  // Linting is run separately via `npm run lint`. See eslint.config.mjs.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;