'use client';

import React from 'react';
import { BoardForm, type BoardFormData } from '@/components/board';

/**
 * Create Demo page — renders the "desk / create" UI from Figma (node 1:913).
 * 
 * Route: /create-demo
 * Purpose: Quick visual verification of all board creation UI components.
 */
export default function CreateDemoPage() {
  const handleSubmit = async (data: BoardFormData) => {
    console.log('Board form submitted:', JSON.stringify(data, null, 2));
    alert(`Board "${data.name}" data logged to console! (${Object.keys(data).length} fields)`);
  };

  return (
    <div
      className="min-h-screen w-full"
      style={{ backgroundColor: '#0A0A0A' }}
    >
      {/* Demo banner */}
      <div
        className="text-center py-2 text-xs border-b border-white/10"
        style={{ color: '#8B8B8B', fontFamily: "'Inter', system-ui, sans-serif" }}
      >
        Demo — Create Board UI (Figma node 1:913) | http://localhost:3000/create-demo
      </div>

      <div className="mx-auto">
        <BoardForm onSubmit={handleSubmit} />
      </div>
    </div>
  );
}