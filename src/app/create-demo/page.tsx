'use client';

import React from 'react';
import { CreateDeskForm, type CreateDeskFormValue } from '@/components/desk-create';

/**
 * Create Demo page — renders the new pixel‑perfect desk/create UI.
 * 
 * Route: /create-demo
 * Purpose: Quick visual verification of all board creation UI components.
 */
export default function CreateDemoPage() {
  const handleSubmit = async (value: CreateDeskFormValue) => {
    console.log('Board form submitted:', JSON.stringify(value, null, 2));
    alert(`Board "${value.name}" data logged to console! (${Object.keys(value).length} fields)`);
  };

  return (
    <div
      className="h-full min-h-dvh w-full"
      style={{ backgroundColor: '#0A0A0A' }}
    >
      {/* Demo banner */}
      <div
        className="text-center py-2 text-xs border-b border-white/10"
        style={{ color: '#8B8B8B', fontFamily: "'Inter', system-ui, sans-serif" }}
      >
        Demo — Create Board UI (Figma node 1:913) | http://localhost:3000/create-demo
      </div>

      <CreateDeskForm
        onSubmit={handleSubmit}
        onAddColleague={() => console.log('add colleague')}
      />
    </div>
  );
}