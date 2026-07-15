// Supabase client — createServerClient for Next.js Route Handlers
// Uses service role key for server-side operations (bypasses RLS)

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * Server-side Supabase client with service role key.
 * Bypasses RLS policies — use only in server components and API routes.
 */
export function createServerClient() {
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Public Supabase client (anon key).
 * Subject to RLS policies — use in browser/client components.
 */
export function createBrowserClient() {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return createClient<Database>(SUPABASE_URL, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
    },
  });
}