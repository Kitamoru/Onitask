-- Migration 022: Fix storage_path format for workspace_documents
-- Purpose: Reset incorrect storage_path values set by migration 021.
--          Migration 021 incorrectly set: {workspace_id}/{id}_{filename}
--          Correct format is: {workspace_id}/{uuid}.{ext} (set at upload time)
--
-- Strategy: Set storage_path to empty string (not NULL, since column is NOT NULL).
-- The API fallback logic handles both NULL and empty string the same way.

-- 1. Reset incorrect storage_path values to empty string
UPDATE workspace_documents
SET storage_path = ''
WHERE storage_path IS NOT NULL 
  AND storage_path != ''
  AND storage_path LIKE '%__%';  -- Pattern from migration 021 contains double underscore

-- 2. Add comment explaining the storage path format
COMMENT ON COLUMN workspace_documents.storage_path IS 
  'Path in Supabase Storage documents bucket. Format: {workspace_id}/{uuid}.{ext}. Empty or wrong values mean API will use fallback: {workspace_id}/{filename}.';
