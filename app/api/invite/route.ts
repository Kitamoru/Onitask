'use server';

/**
 * POST /api/invite — Generate a new invite link for the user's workspace
 * 
 * WS-06: One active invite link per workspace at a time.
 * Generating a new link deactivates the previous one (is_active = false).
 * Links expire after 24 hours (created_at > NOW() - INTERVAL '24 hours').
 * 
 * Security:
 * - Rate limit: 10 requests per 15 minutes per IP (SEC-02)
 * - Only authorized users can generate links
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabase';
import type { Database } from '../../../types/supabase';
import type { PostgrestResponse, PostgrestError } from '@supabase/supabase-js';

const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'Onitask_bot';
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Simple in-memory rate limiter (replace with Redis in production)
const rateLimitStore = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitStore.get(ip) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    return false;
  }
  recent.push(now);
  rateLimitStore.set(ip, recent);
  return true;
}

export async function POST(req: NextRequest) {
  try {
    // Auth check via session
    const supabase = createServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return NextResponse.json(
        { success: false, error: 'not_authorized' },
        { status: 401 },
      );
    }

    // Get workspace_id from body
    const body = await req.json();
    const { workspace_id } = body as { workspace_id?: string };

    if (!workspace_id) {
      return NextResponse.json(
        { success: false, error: 'missing_workspace_id' },
        { status: 400 },
      );
    }

    // Verify user has access to this workspace
    const { data: workerData, error: workerError } = await supabase
      .from('workers')
      .select('id, role')
      .eq('source_id', authUser.id)
      .eq('workspace_id', workspace_id)
      .eq('is_active', true)
      .single();

    if (workerError || !workerData) {
      return NextResponse.json(
        { success: false, error: 'workspace_not_found' },
        { status: 403 },
      );
    }

    // Rate limiting by IP
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { success: false, error: 'rate_limit_exceeded' },
        { status: 429 },
      );
    }

    // Generate unique code
    const code = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

    // Step 1: Deactivate old active invite for this workspace
    await supabase
      .from('invite_links')
      .update({ is_active: false })
      .eq('workspace_id', workspace_id)
      .eq('is_active', true);

    // Step 2: Delete expired invites (>24h)
    await supabase
      .from('invite_links')
      .delete()
      .eq('workspace_id', workspace_id)
      .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    // Step 3: Insert new invite link
    const { data: newDataRaw, error: insertError } = await supabase
      .from('invite_links')
      .insert({
        workspace_id,
        code,
        created_by: workerData.id,
        is_active: true,
      } as Database['public']['Tables']['invite_links']['Insert'])
      .select('code, created_at')
      .single();

    // .single() returns { data: { code: string; created_at: string } | null, error }
    const newData = newDataRaw as { code: string; created_at: string } | null;

    if (insertError) {
      // Check if it's a unique constraint violation (race condition)
      const err = insertError as PostgrestError;
      if (err.code === '23505') {
        // Another request won the race — return the existing one
        const { data: existing, error: existingError } = await supabase
          .from('invite_links')
          .select('code, created_at')
          .eq('workspace_id', workspace_id)
          .eq('is_active', true)
          .maybeSingle();

        if (existingError) {
          console.error('invite: race condition fetch error', existingError);
          return NextResponse.json(
            { success: false, error: 'database_error' },
            { status: 500 },
          );
        }

        if (existing) {
          const url = `https://t.me/${TELEGRAM_BOT_USERNAME}/Onitask?startapp=${existing.code}`;
          return NextResponse.json({
            success: true,
            data: {
              url,
              code: existing.code,
              created_at: existing.created_at,
            },
          });
        }
      }

      console.error('invite: creation error', insertError);
      return NextResponse.json(
        { success: false, error: 'creation_failed' },
        { status: 500 },
      );
    }

    const finalCode = newData?.code ?? code;
    const finalCreatedAt = newData?.created_at ?? new Date().toISOString();
    const url = `https://t.me/${TELEGRAM_BOT_USERNAME}/Onitask?startapp=${finalCode}`;

    return NextResponse.json({
      success: true,
      data: { url, code: finalCode, created_at: finalCreatedAt },
    });
  } catch (err) {
    console.error('invite: unexpected error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/invite — Get the current active invite link for a workspace
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return NextResponse.json(
        { success: false, error: 'not_authorized' },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(req.url);
    const workspace_id = searchParams.get('workspace_id');

    if (!workspace_id) {
      return NextResponse.json(
        { success: false, error: 'missing_workspace_id' },
        { status: 400 },
      );
    }

    // Verify user has access to this workspace
    const { data: workerData } = await supabase
      .from('workers')
      .select('id')
      .eq('source_id', authUser.id)
      .eq('workspace_id', workspace_id)
      .eq('is_active', true)
      .single();

    if (!workerData) {
      return NextResponse.json(
        { success: false, error: 'workspace_not_found' },
        { status: 403 },
      );
    }

    // Get current active invite (not expired)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: inviteRaw, error: inviteError } = await supabase
      .from('invite_links')
      .select('code, created_at, created_by')
      .eq('workspace_id', workspace_id)
      .eq('is_active', true)
      .gte('created_at', cutoff)
      .maybeSingle();

    // maybeSingle() returns { data: Row | null, error }
    const invite = inviteRaw as Database['public']['Tables']['invite_links']['Row'] | null;

    if (inviteError) {
      console.error('invite: fetch error', inviteError);
      return NextResponse.json(
        { success: false, error: 'database_error' },
        { status: 500 },
      );
    }

    if (!invite) {
      return NextResponse.json({
        success: true,
        data: null,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        code: invite.code,
        created_at: invite.created_at,
        created_by: invite.created_by,
      },
    });
  } catch (err) {
    console.error('invite: GET unexpected error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}