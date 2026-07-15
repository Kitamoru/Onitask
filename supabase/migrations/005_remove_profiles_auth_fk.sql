-- 005_remove_profiles_auth_fk.sql
-- Remove FK constraint on profiles.id → auth.users(id) for MVP
-- Authorization is handled via Telegram initData, not Supabase Auth
-- FK will be restored when Supabase Auth integration is implemented

DO $$ BEGIN
  ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_id_fkey;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;