-- Migration 070: drop workspace_settings.agent_duty_playbook (ADR R1)
--   Duty playbooks are fully out of 0.9 scope; the column was left inert
--   after stage 5. Now cleaned up: no runtime readers, no RPC/view deps,
--   0 non-null rows. Playbook prompt texts preserved in
--   docs/playbook-archive/dutyPlaybook.ts.

ALTER TABLE public.workspace_settings
  DROP COLUMN IF EXISTS agent_duty_playbook;