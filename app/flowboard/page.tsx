'use client';

import React from 'react';
import { FlowBoard } from '@/components/flowboard';

/**
 * FlowBoard Page — displays the flow task overview based on Figma design (node 1:445).
 * 
 * This page serves as the foundation for Stage 4 development.
 * All data is currently mocked — replace with API calls when backend is ready.
 */

export default function FlowBoardPage() {
  // Mock data matching Figma spec
  const sprint = {
    name: 'Спринт 3',
    topic: 'Auth & MCP',
    startDate: '19',
    endDate: '25 мая',
    daysElapsed: 1,
    totalDays: 7,
    progress: 35,
    doneSP: 12,
    totalSP: 34,
    inProgress: 5,
    onReview: 6,
    isActive: true,
  };

  const signals = [
    { id: 's1', label: 'Люди', count: 1, description: '@kitamoru 7/6' },
    { id: 's2', label: 'Процессы', count: 3, description: 'Ревью 2, Блокеры 13' },
    { id: 's3', label: 'Эскалации', count: 2, description: 'Нужен @kitamoru' },
  ];

  const taskStatuses = [
    {
      id: 'ts1',
      label: 'Активные',
      count: 7,
      shapes: 7,
      maxShapes: 10,
      color: 'var(--color-accent-amber)',
    },
    {
      id: 'ts2',
      label: 'В очереди',
      count: 1,
      shapes: 1,
      maxShapes: 10,
      color: 'var(--color-text-white)',
    },
    {
      id: 'ts3',
      label: 'На проверке',
      count: 6,
      shapes: 6,
      maxShapes: 10,
      color: 'var(--color-signal-cyan)',
    },
    {
      id: 'ts4',
      label: 'Сделано',
      count: 12,
      shapes: 10,
      maxShapes: 10,
      color: 'var(--color-signal-green)',
    },
  ];

  const workers = [
    {
      id: 'w1',
      displayName: 'kitamoru',
      cognitiveWeight: 2,
      spPerDay: 3.5,
      trendUp: true,
      activeDays: 5,
      roleLabel: '🎪 Лидер команды',
      overloaded: true,
      tasks: [],
    },
    {
      id: 'w2',
      displayName: 'truebulat',
      cognitiveWeight: 2,
      spPerDay: 3.5,
      trendUp: true,
      activeDays: 5,
      roleLabel: '📐 Архитектор пользовательского опыта',
      tasks: ['📌 Иконки Team Tab · 2д'],
    },
    {
      id: 'w3',
      displayName: 'amy\\_sher',
      cognitiveWeight: 2,
      spPerDay: 3.5,
      trendUp: true,
      activeDays: 5,
      roleLabel: '👸 Графиня',
      tasks: ['📌 Team Tab UX · 3д'],
    },
    {
      id: 'w4',
      displayName: 'PaulinaIva',
      cognitiveWeight: 2,
      spPerDay: 3.5,
      trendUp: true,
      activeDays: 5,
      roleLabel: '🇷🇺 Тестер всея Руси',
      tasks: [],
    },
    {
      id: 'w5',
      displayName: 'kazikmalevich',
      cognitiveWeight: 2,
      spPerDay: 3.5,
      trendUp: true,
      activeDays: 5,
      roleLabel: '💊 Управленец',
      tasks: [],
    },
  ];

  const agents = [
    {
      id: 'a1',
      name: 'agent_name',
      cognitiveWeight: 2,
      spPerDay: 3.5,
      trendUp: true,
      activeDays: 5,
      roleLabel: '🎪 Лидер команды',
      tasks: [],
    },
    {
      id: 'a2',
      name: 'agent_name',
      cognitiveWeight: 2,
      spPerDay: 3.5,
      trendUp: true,
      activeDays: 5,
      roleLabel: '📐 Архитектор пользовательского опыта',
      tasks: ['📌 Иконки Team Tab · 2д'],
    },
  ];

  return (
    <FlowBoard
      title="Флоу задач"
      currentDate="Четверг, 20 мая"
      sprint={sprint}
      signals={signals}
      taskStatuses={taskStatuses}
      workers={workers}
      agents={agents}
      onAddWorker={() => console.log('Add worker clicked')}
      onAddAgent={() => console.log('Add agent clicked')}
    />
  );
}