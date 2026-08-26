-- Migration 058: get_task_card_data returns full template fields
-- /call (lookup) must render the SAME unified task card as bot-notify
-- notifications: description blockquote + "✍️ Постановщик" line.
-- Adds 'description' and 'assignedByName' (creator worker display_name) to the
-- jsonb returned by get_task_card_data. Keys are camelCase to match TaskCardData.

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
  'workspaceHandle', ws.slug,
  'clarityScore', t.clarity_score
)
FROM tasks t
JOIN workspaces ws ON ws.id = t.workspace_id
LEFT JOIN workers wkr ON wkr.id = t.assigned_to
LEFT JOIN workers cw ON cw.id = t.created_by
WHERE t.id = p_task_id;
$$;