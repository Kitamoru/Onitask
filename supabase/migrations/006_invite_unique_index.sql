-- WS-06: Partial unique index to ensure at most one active invite link per workspace
-- This prevents race conditions where two admins generate links simultaneously

CREATE UNIQUE INDEX idx_one_active_per_workspace
ON public.invite_links (workspace_id)
WHERE is_active = true;