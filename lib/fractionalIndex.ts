/**
 * Fractional Indexing Utility (FLOW-03)
 *
 * Implements position = (prev + next) / 2 strategy for drag-and-drop ordering.
 * When positions collide (no prev or next available within tolerance),
 * rescales all positions in the column to create space.
 *
 * Based on: product_vision UC-03, TASKS.md Stage 4 FLOW-03
 */

// Tolerance for position collision detection
const POSITION_TOLERANCE = 0.001;

// Minimum gap between positions to avoid floating point issues
const MIN_POSITION_GAP = 0.0001;

interface PositionContext {
  /** Position of the item before the target position */
  prevPosition: number | null;
  /** Position of the item after the target position */
  nextPosition: number | null;
}

/**
 * Calculate a new fractional position between two existing positions.
 * Returns (prev + next) / 2, with minimum gap enforcement.
 */
export function calculateFractionalPosition(
  prevPosition: number | null,
  nextPosition: number | null,
): number {
  // No previous item — place at start
  if (prevPosition === null) {
    if (nextPosition === null) {
      // Only item in column
      return 65536.0;
    }
    // Place well before the first item
    return Math.max(0, nextPosition - 1024);
  }

  // No next item — place at end
  if (nextPosition === null) {
    return prevPosition + 1024;
  }

  // Both exist — calculate midpoint
  const mid = (prevPosition + nextPosition) / 2;

  // Ensure minimum gap
  if (nextPosition - prevPosition < MIN_POSITION_GAP * 2) {
    // Positions too close — place just after prev
    return prevPosition + MIN_POSITION_GAP;
  }

  // Check if mid is too close to either neighbor
  if (mid - prevPosition < POSITION_TOLERANCE) {
    return prevPosition + POSITION_TOLERANCE;
  }
  if (nextPosition - mid < POSITION_TOLERANCE) {
    return nextPosition - POSITION_TOLERANCE;
  }

  return mid;
}

/**
 * Check if rescaling is needed (all positions in column are too close).
 * Returns true if any two adjacent positions differ by less than tolerance.
 */
export function needsRescale(positions: number[]): boolean {
  if (positions.length <= 1) return false;

  const sorted = [...positions].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] < MIN_POSITION_GAP * 2) {
      return true;
    }
  }
  return false;
}

/**
 * Rescale all positions in a column to create even spacing.
 * Uses powers of 2 for initial placement: 1024, 2048, 4096, etc.
 * Then normalizes to standard range if needed.
 */
export function rescalePositions(
  oldPositions: Map<string, number>,
  newOrder: string[], // task IDs in desired order
): Map<string, number> {
  const result = new Map<string, number>();
  const base = 1024;

  newOrder.forEach((id, index) => {
    result.set(id, base * (index + 1));
  });

  return result;
}

/**
 * Get optimal position for inserting a task at a specific index in a column.
 * Takes all current positions in the column and calculates the best slot.
 */
export function getOptimalInsertPosition(
  currentIndex: number,
  allPositions: number[],
): number {
  if (allPositions.length === 0) {
    return 65536.0;
  }

  const sorted = [...allPositions].sort((a, b) => a - b);

  if (currentIndex === 0) {
    // Insert at beginning
    return Math.max(0, sorted[0] - 1024);
  }

  if (currentIndex >= sorted.length) {
    // Insert at end
    return sorted[sorted.length - 1] + 1024;
  }

  // Insert between sorted[currentIndex-1] and sorted[currentIndex]
  const prevPos = sorted[currentIndex - 1];
  const nextPos = sorted[currentIndex];
  return calculateFractionalPosition(prevPos, nextPos);
}