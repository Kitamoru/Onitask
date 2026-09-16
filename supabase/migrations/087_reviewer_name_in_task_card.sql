-- ============================================================================
-- 087_reviewer_name_in_task_card.sql
-- Purpose: unified task card shows a «🔍 Проверяющий» line when the task has
--          tasks.reviewer_id (INV-02). Adds 'reviewerName' (reviewer worker
--          display_name) to the jsonb returned by get_task_card_data.
--          Keys are camelCase to match TaskCardData (pattern 058).
-- Note: get_task_card_data_by_full_id (057) delegates here — no changes needed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_task_card_data(p_task_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
SELECT jsonb_build_object(
  'fullId', ws.task_prefix || '-'::text || t.task_number,
  'title', t.title,
  'description', t.description,
  'column', t.column,
  'isInbox', t.is_inbox,
  'isBlocked', EXISTS (
    SELECT 1 FROM task_relations tr
    JOIN tasks dep ON dep.id = tr.from_task_id
    WHERE tr.to_task_id = t.id AND dep.column != 'done'
  ),
  'priority', CASE 
    WHEN t.priority IN ('critical', 'high') THEN 'high'
    WHEN t.priority = 'medium' THEN 'medium'
    WHEN t.priority = 'low' THEN 'low'
    ELSE null
  END,
  'dueDate', t.deadline::text,
  'assigneeName', wkr.display_name,
  'assignedByName', cw.display_name,
  'reviewerName', rv.display_name,
  'workspaceHandle', ws.slug,
  'clarityScore', t.clarity_score
)
FROM tasks t
JOIN workspaces ws ON ws.id = t.workspace_id
LEFT JOIN workers wkr ON wkr.id = t.assigned_to
LEFT JOIN workers cw ON cw.id = t.created_by
LEFT JOIN workers rv ON rv.id = t.reviewer_id
WHERE t.id = p_task_id;
$$;

COMMENT ON FUNCTION public.get_task_card_data(uuid) IS
  '033 + 058 + 087: единый источник данных карточки задачи бота (create/duplicate/lookup). 087: ключ reviewerName (workers.display_name по tasks.reviewer_id) — строка «🔍 Проверяющий» в карточке при наличии.';
