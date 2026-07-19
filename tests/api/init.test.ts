// Tests for POST /api/init — Auth flow validation
// AUTH-03: 401-обработка + интеграционный тест (mock-based)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../src/app/api/init/route';
import type { NextRequest } from 'next/server';

// Mock modules
const mockValidateTelegramInitData = vi.fn();
const mockCreateServerClient = vi.fn();

vi.mock('@/lib/telegramAuth', () => ({
  validateTelegramInitData: (...args: any[]) => mockValidateTelegramInitData(...args),
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: (...args: any[]) => mockCreateServerClient(...args),
}));

// Helper to create a mock NextRequest
function createMockRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('POST /api/init', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Тест 1: Missing init_data → 400
  it('returns 400 when init_data is missing', async () => {
    const request = createMockRequest({});
    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('missing_init_data');
  });

  // Тест 2: Invalid initData (bad hash) → 401
  it('returns 401 when hash is invalid', async () => {
    mockValidateTelegramInitData.mockResolvedValue({
      valid: false,
      error: 'invalid_hash',
    });

    const request = createMockRequest({ init_data: 'user=eyJpZCI6IjEyMyJ9&hash=abc123' });
    const response = await POST(request);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('invalid_hash');
  });

  // Тест 3: Expired initData (>24h) → 401
  it('returns 401 when auth_date is expired', async () => {
    mockValidateTelegramInitData.mockResolvedValue({
      valid: false,
      error: 'expired_init_data',
    });

    const oldTimestamp = Math.floor(Date.now() / 1000) - 100000; // > 24 hours ago
    const request = createMockRequest({
      init_data: `user=eyJpZCI6IjEyMyJ9&auth_date=${oldTimestamp}&hash=abc`,
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('expired_init_data');
  });

  // Тест 4: Valid initData, new user → 200 + is_new_user=true
  it('returns 200 with is_new_user=true for new user', async () => {
    // Mock successful Telegram validation
    mockValidateTelegramInitData.mockResolvedValue({
      valid: true,
      user: {
        id: '987654321',
        is_bot: false,
        first_name: 'Test',
        last_name: 'User',
        username: 'testuser',
        language_code: 'en',
      },
    });

    // Mock Supabase: profile not found (maybeSingle returns null)
    const mockSupabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    };

    // Mock profile creation
    const mockInsertResult = {
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'new-user-uuid-here',
            telegram_id: 987654321,
            display_name: 'testuser',
            avatar_url: null,
          },
          error: null,
        }),
      })),
    };
    (mockSupabase.from as any).mockReturnValue({
      insert: vi.fn().mockReturnValue(mockInsertResult),
    });

    mockCreateServerClient.mockReturnValue(mockSupabase);

    const request = createMockRequest({
      init_data: 'user=eyJpZCI6Ijk4NzY1NDMyMSIsImZpcnN0X25hbWUiOiJUZXN0IiwibGFzdF9uYW1lIjoiVXNlciIsInVzZXJuYW1lIjoidGVzdHVzZXIiLCJsYW5ndWFnZV9jb2RlIjoiZW4ifQ&auth_date=1700000000&hash=valid_hash',
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.is_new_user).toBe(true);
    expect(data.data.worker.display_name).toBe('testuser');
  });
});