-- Migration 057: get_task_card_data_by_full_id RPC
-- ONIT-18: /call command was crashing because get_task_card_data_by_full_id
-- RPC did not exist. This migration adds the missing function.

CREATE OR REPLACE FUNCTION get_task_card_data_by_full_id(p_full_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT get_task_card_data(find_task_by_full_id(p_full_id));
$$;
