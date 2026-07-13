// Request / Response типы для Route Handlers
// Centralized API types for all Next.js API routes

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Task API types
export interface CreateTaskRequest {
  title: string;
  description?: string;
  workspace_id: string;
  assigned_to?: string;
  due_date?: string;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: string;
  assigned_to?: string;
  due_date?: string;
}

export interface TaskResponse {
  id: string;
  title: string;
  description: string;
  status: string;
  workspace_id: string;
  assigned_to: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

// Workspace API types
export interface CreateWorkspaceRequest {
  name: string;
  slug: string;
  task_prefix: string;
}

export interface WorkspaceResponse {
  id: string;
  name: string;
  slug: string;
  task_prefix: string;
  created_at: string;
}