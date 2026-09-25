export interface LatestLoadGuard {
  begin: () => number;
  isCurrent: (generation: number) => boolean;
}

/** Prevent a late workspace response from overwriting a newer workspace load. */
export function createLatestLoadGuard(): LatestLoadGuard {
  let current = 0;
  return {
    begin: () => ++current,
    isCurrent: (generation) => generation === current,
  };
}
