'use client';

import React from 'react';
import { BoardDetail } from '@/components/board';

/**
 * Test page for BoardDetail component — displays mock data without DB connection.
 * 
 * Route: /board/test
 */

const MOCK_SPRINT = {
  id: 'test-sprint-1',
  name: 'Спринт 3',
  topic: 'Auth & MCP',
  startDate: '19 мая',
  endDate: '25 мая',
  daysElapsed: 3,
  totalDays: 7,
};

const MOCK_SPRINT_TASKS = [
  { id: 't1', title: 'Task 1', column: 'people' },
  { id: 't2', title: 'Task 2', column: 'process' },
  { id: 't3', title: 'Task 3', column: 'escalation' },
];

const MOCK_COLLEAGUES = [
  {
    id: 'w1',
    displayName: 'kitamoru',
    avatarUrl: undefined,
    cognitiveWeight: 2,
    spPerDay: 3.5,
    trendUp: true,
    roleLabel: '🎪 Лидер команды',
    activeTasks: 5,
    overloaded: true,
    tasks: ['📌 Иконки Team Tab · 2д', '🎪 Auth flow · 3д'],
  },
  {
    id: 'w2',
    displayName: 'truebulat',
    avatarUrl: undefined,
    cognitiveWeight: 2,
    spPerDay: 3.5,
    trendUp: true,
    roleLabel: '📐 Архитектор пользовательского опыта',
    activeTasks: 4,
    overloaded: false,
    tasks: ['📌 Team Tab UX · 3д'],
  },
  {
    id: 'w3',
    displayName: 'amy\\_sher',
    avatarUrl: undefined,
    cognitiveWeight: 1,
    spPerDay: 2.0,
    trendUp: false,
    roleLabel: '👸 Графиня',
    activeTasks: 2,
    overloaded: false,
    tasks: [],
  },
  {
    id: 'w4',
    displayName: 'PaulinaIva',
    avatarUrl: undefined,
    cognitiveWeight: 3,
    spPerDay: 4.0,
    trendUp: true,
    roleLabel: '🇷🇺 Тестер всея Руси',
    activeTasks: 6,
    overloaded: true,
    tasks: ['📌 Regression suite · 1д'],
  },
  {
    id: 'w5',
    displayName: 'kazikmalevich',
    avatarUrl: undefined,
    cognitiveWeight: 1,
    spPerDay: 1.5,
    trendUp: false,
    roleLabel: '💊 Управленец',
    activeTasks: 1,
    overloaded: false,
    tasks: [],
  },
];

const MOCK_EXTERNAL_LINKS = [
  { id: 'l1', label: 'Tg-chat', url: 'https://t.me/onitask' },
  { id: 'l2', label: 'Figma design-system', url: 'https://figma.com/file/design' },
  { id: 'l3', label: 'Git repository', url: 'https://github.com/Kitamoru/Onitask' },
];

const MOCK_DOCUMENTS = [
  { id: 'd1', filename: 'architecture.md', fileType: 'markdown' as const },
  { id: 'd2', filename: 'api-contracts.md', fileType: 'markdown' as const },
  { id: 'd3', filename: 'context.md', fileType: 'markdown' as const },
];

export default function BoardDetailTestPage() {
  return (
    <BoardDetail
      boardName="Test Board"
      slug="test"
      sprint={MOCK_SPRINT}
      sprintTasks={MOCK_SPRINT_TASKS}
      colleagues={MOCK_COLLEAGUES}
      externalLinks={MOCK_EXTERNAL_LINKS}
      documents={MOCK_DOCUMENTS}
      deadlineWarningDays={1}
      loading={false}
    />
  );
}