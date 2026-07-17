'use client';

import React from 'react';
import { WorkspaceWizard } from '@/components/board';

/**
 * Wizard page — Workspace creation flow for new users.
 * 
 * Route: /wizard
 * Used when is_new_user === true from /api/init response.
 * 
 * Flow:
 * 1. User fills workspace details (name, slug, context)
 * 2. Submit → POST /api/workspaces
 * 3. On success → redirect to /board/[slug]
 * 4. On error → show error message in form
 */

export default function WizardPage() {
  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: '#0A0A0A' }}>
      <WorkspaceWizard />
    </div>
  );
}