export type SprintFormValue = {
  name: string;
  startDate: Date | null;
  endDate: Date | null;
  goal?: string;
  /** Task IDs assigned to this sprint (sent as `task_ids` to the API) */
  taskIds?: string[];
};

export type SprintStats = {
  completedTasks: number;
  totalTasks: number;
  daysLeft: number;
};