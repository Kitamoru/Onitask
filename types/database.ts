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
    };
    Views: {};
    Functions: {};
    Enums: {};
  };
}