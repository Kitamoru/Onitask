// useKanban hook — Local state + optimistic updates for Flow Board
// Manages column order, card positions, and drag-and-drop state

export interface KanbanCard {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  urgency?: 'low' | 'medium' | 'high' | 'critical';
  etaDrift?: number;
  enrichmentStatus?: 'pending' | 'done' | 'failed';
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

export function useKanban() {
  const columns: KanbanColumn[] = [];

  return {
    columns,
    moveCard: async (_cardId: string, _fromColumnId: string, _toColumnId: string) => {},
    addCard: async (_columnId: string, _card: Omit<KanbanCard, 'id'>) => {},
    updateCard: async (_cardId: string, _updates: Partial<KanbanCard>) => {},
    deleteCard: async (_cardId: string) => {},
  };
}