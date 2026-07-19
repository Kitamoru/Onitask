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
};

export default nextConfig;