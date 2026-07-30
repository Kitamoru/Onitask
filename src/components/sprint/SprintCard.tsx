'use client';

import React from 'react';
import { SprintCompressedInfo } from '@/components/flowboard/FlowBoard';
import type { SprintInfo } from '@/types/flowboard';

export function SprintCard({
  sprint,
  onClick,
}: {
  sprint?: SprintInfo;
  onClick: () => void;
}) {
  return (
    <div
      className="cursor-pointer transition-opacity hover:opacity-90"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={sprint ? `Открыть спринт ${sprint.name}` : 'Создать спринт'}
    >
      <SprintCompressedInfo sprint={sprint} />
    </div>
  );
}