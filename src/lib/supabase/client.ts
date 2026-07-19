'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Singleton browser-side Supabase client.
 * Prevents "Multiple GoTrueClient instances detected" warnings
 * by ensuring only one auth client instance exists per app.
 */
let supabaseClient: ReturnType<typeof createBrowserClient> | null = null;

export function getClient(): ReturnType<typeof createBrowserClient> {
  if (!supabaseClient) {
    supabaseClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return supabaseClient;
}