import type { BoardCardData } from "@/components/boards/BoardCard";

/**
 * Mirrors the reference screenshot 1:1, for wiring up the route quickly.
 *
 * Note: in the reference screenshot itself, the header reads "активная:
 * @alpha" while the framed (active) card's own line reads "@blag" — an
 * inconsistency in the source mock's placeholder content, not something
 * introduced here. BoardsPage derives the header handle from
 * `activeBoard.handle`, so the two are kept in sync below (board-1 →
 * "alpha") rather than reproducing that mismatch.
 */
export const exampleBoards: BoardCardData[] = Array.from({ length: 4 }).map((_, i) => ({
  id: `board-${i + 1}`,
  name: "Благополучная доска",
  handle: i === 0 ? "alpha" : "blag",
  avatarUrl: "/avatars/placeholder.jpg",
  memberCount: 4,
  agentCount: 2,
  stats: { inProgress: 7, escalations: 2, overloaded: 1, done: 12 },
  sprint: { label: "Спринт 3", scope: "Auth & MCP", dayCurrent: 6, dayTotal: 14 },
}));

export const exampleSummary = { people: 2, processes: 1, escalations: 28 };
export const exampleActiveBoardId = "board-1";
