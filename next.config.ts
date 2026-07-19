import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── Rendering strategy for Telegram Web App ──────────────────────────
  // TWA apps are fully client-driven: Telegram SDK (window.Telegram)
  // doesn't exist on server, so we avoid full SSR.
  //
  // Best practice: CSR shell + streaming Suspense for data fetches.
  // Auth routes must NOT use ISR (Set-Cookie caching issues).
  experimental: {
    // Enable streaming SSR with Suspense boundaries
    // This shows the app shell immediately, then streams in data
    dynamicIO: true,          // Allow dynamic I/O in app directory (Next.js 15+)
    optimizePackageImports: [
      '@supabase/ssr',
      '@supabase/supabase-js',
      'lucide-react',
      'react-syntax-highlighter',
    ],
  },
};

export default nextConfig;
