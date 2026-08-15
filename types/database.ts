// Generated types from Supabase schema
// Run `supabase gen types typescript --project-id <id>` to regenerate

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      workspaces: {
        Row: {
          id: string;
          created_at: string;
          name: string;
          slug: string;
          task_prefix: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          name: string;
          slug: string;
          task_prefix: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          name?: string;
          slug?: string;
          task_prefix?: string;
        };
      };
      tasks: {
        Row: {
          id: string;
          workspace_id: string;
          created_at: string;
          title: string;
          status: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          created_at?: string;
          title: string;
          status: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          created_at?: string;
          title?: string;
          status?: string;
        };
      };
      workers: {
        Row: {
          id: string;
          workspace_id: string;
          source_id: string;
          source_type: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          source_id: string;
          source_type: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          source_id?: string;
          source_type?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      workspace_telegram_chats: {
        Row: {
          id: string;
          workspace_id: string;
          chat_id: number;
          chat_type: string;
          is_active: boolean;
          linked_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          chat_id: number;
          chat_type: string;
          is_active?: boolean;
          linked_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          chat_id?: number;
          chat_type?: string;
          is_active?: boolean;
          linked_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
  };
}