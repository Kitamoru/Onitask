export type SprintFormValue = {
  name: string;
  startDate: Date | null;
  endDate: Date | null;
  goal: string;
  /** Kept as a string, not a number — same pattern as StoryPointCostCard's
   *  hour fields in desk-create: a controlled text field avoids native
   *  number-input spinner arrows, which don't match this design system's
   *  custom field chrome. */
  capacity: string;
};

export type SprintStats = {
  completedTasks: number;
  totalTasks: number;
  daysLeft: number;
};
