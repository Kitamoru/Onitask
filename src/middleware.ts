import { NextResponse, type NextRequest } from 'next/server';

/**
 * Lightweight middleware for TWA (Telegram Web App).
 *
 * Best practice: auth is entirely client-driven via Telegram initData → POST /api/init.
 * The server cannot validate initData at Edge level before the client sends it.
 * So we skip Supabase session checks here — they happen in the browser via useAuth hook.
 *
 * We only exclude:
 * - Static assets & Next.js internals
 * - API routes (except those that genuinely need middleware, e.g. calendar callbacks)
 */
export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Allow all other requests through — no server-side auth check needed.
  // Client-side auth (useAuth hook + sessionStorage) handles protection.
  return NextResponse.next();
}

// Exclude static files, Next.js internals, and common asset types
export const config = {
  matcher: [
    /*
     * Match only pathnames of the following kinds.
     * See: https://nextjs.org/docs/app/building-your-application/routing/middleware#matcher
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|woff2?)$).*)',
  ],
};
