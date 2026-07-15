// Global test setup - mocks for external dependencies
import { vi } from 'vitest';

// Mock Supabase client
const mockSupabaseClient = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(),
        single: vi.fn(),
      })),
      in: vi.fn(() => ({
        maybeSingle: vi.fn(),
      })),
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(),
      })),
    })),
  })),
};

vi.mock('@/lib/supabase', () => ({
  createServerClient: () => mockSupabaseClient,
}));

// Mock Telegram auth - will be overridden per-test if needed
vi.mock('@/lib/telegramAuth', () => ({
  validateTelegramInitData: vi.fn(() => 
    Promise.resolve({ valid: false, error: 'mock_invalid' })
  ),
}));