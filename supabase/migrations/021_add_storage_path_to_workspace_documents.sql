-- Migration 021: Add storage_path to workspace_documents
-- Purpose: Store the Supabase Storage path for each uploaded document
--         to enable correct file deletion from storage bucket.

-- 1. Add the column (idempotent)
ALTER TABLE workspace_documents ADD COLUMN IF NOT EXISTS storage_path text;

-- 2. Create index for faster lookups by storage_path
CREATE INDEX IF NOT EXISTS idx_workspace_documents_storage_path ON workspace_documents(storage_path);

-- 3. Update existing records with a computed storage_path
--    Format: {workspace_id}/{filename} where filename is the UUID-based name used during upload
UPDATE workspace_documents
SET storage_path = CONCAT(workspace_id::text, '/', id::text, '_', filename)
WHERE storage_path IS NULL;