import { create } from 'zustand';
import type { TaskEntity } from '@/types/flowboard';

export interface SwappedTaskEntry {
  targetColumn: string;
  originalTask: TaskEntity;
}

interface SwappedTasksState {
  swappedTasks: Map<string, SwappedTaskEntry>;
  setSwappedTasks: (updater: (prev: Map<string, SwappedTaskEntry>) => Map<string, SwappedTaskEntry>) => void;
}

export const useSwappedTasksStore = create<SwappedTasksState>((set) => ({
  swappedTasks: new Map(),
  setSwappedTasks: (updater) =>
    set((state) => ({
      swappedTasks: updater(state.swappedTasks),
    })),
}));