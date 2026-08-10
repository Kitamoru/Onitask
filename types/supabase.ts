export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_events: {
        Row: {
          agent_name: string
          created_at: string
          id: string
          metadata: Json
          state_before: Json | null
          summary: string | null
          task_id: string | null
          tool: string
          workspace_id: string
        }
        Insert: {
          agent_name: string
          created_at?: string
          id?: string
          metadata?: Json
          state_before?: Json | null
          summary?: string | null
          task_id?: string | null
          tool: string
          workspace_id: string
        }
        Update: {
          agent_name?: string
          created_at?: string
          id?: string
          metadata?: Json
          state_before?: Json | null
          summary?: string | null
          task_id?: string | null
          tool?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task1_id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task2_id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "orphan_blockers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "pending_escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "stale_blocked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "stuck_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_memory: {
        Row: {
          created_at: string
          embedding: string | null
          id: string
          period_end: string | null
          period_start: string | null
          summary_text: string | null
          task_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          id?: string
          period_end?: string | null
          period_start?: string | null
          summary_text?: string | null
          task_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          embedding?: string | null
          id?: string
          period_end?: string | null
          period_start?: string | null
          summary_text?: string | null
          task_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_memory_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task1_id"]
          },
          {
            foreignKeyName: "agent_memory_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task2_id"]
          },
          {
            foreignKeyName: "agent_memory_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "orphan_blockers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_memory_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "pending_escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_memory_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "stale_blocked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_memory_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "stuck_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_memory_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_memory_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_history: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          assignee_id: string | null
          created_at: string
          id: string
          outcome_status: string
          resolved_at: string | null
          snapshot_active_tasks: number | null
          snapshot_attention_risk: number | null
          snapshot_blocked_tasks: number | null
          snapshot_context_switches: number | null
          snapshot_critical_tasks: number | null
          snapshot_review_tasks: number | null
          task_id: string | null
          workspace_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          assignee_id?: string | null
          created_at?: string
          id?: string
          outcome_status?: string
          resolved_at?: string | null
          snapshot_active_tasks?: number | null
          snapshot_attention_risk?: number | null
          snapshot_blocked_tasks?: number | null
          snapshot_context_switches?: number | null
          snapshot_critical_tasks?: number | null
          snapshot_review_tasks?: number | null
          task_id?: string | null
          workspace_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          assignee_id?: string | null
          created_at?: string
          id?: string
          outcome_status?: string
          resolved_at?: string | null
          snapshot_active_tasks?: number | null
          snapshot_attention_risk?: number | null
          snapshot_blocked_tasks?: number | null
          snapshot_context_switches?: number | null
          snapshot_critical_tasks?: number | null
          snapshot_review_tasks?: number | null
          task_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_history_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "assignment_history_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_history_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_history_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "assignment_history_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_history_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task1_id"]
          },
          {
            foreignKeyName: "assignment_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task2_id"]
          },
          {
            foreignKeyName: "assignment_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "orphan_blockers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "pending_escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "stale_blocked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "stuck_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          connected_at: string
          encrypted_oauth_tokens: string
          id: string
          is_active: boolean
          last_sync_at: string | null
          provider: string
          provider_account_email: string
          token_expires_at: string | null
          worker_id: string
          workspace_id: string
        }
        Insert: {
          connected_at?: string
          encrypted_oauth_tokens: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          provider: string
          provider_account_email: string
          token_expires_at?: string | null
          worker_id: string
          workspace_id: string
        }
        Update: {
          connected_at?: string
          encrypted_oauth_tokens?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          provider?: string
          provider_account_email?: string
          token_expires_at?: string | null
          worker_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "calendar_connections_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_connections_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          end_at: string
          id: string
          provider: string
          reminder_minutes_before: number | null
          remote_event_id: string
          source_synced_at: string | null
          start_at: string
          title: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_at: string
          id?: string
          provider: string
          reminder_minutes_before?: number | null
          remote_event_id: string
          source_synced_at?: string | null
          start_at: string
          title: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_at?: string
          id?: string
          provider?: string
          reminder_minutes_before?: number | null
          remote_event_id?: string
          source_synced_at?: string | null
          start_at?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      consolidation_errors: {
        Row: {
          created_at: string
          error_message: string
          id: string
          task_event_id: string | null
        }
        Insert: {
          created_at?: string
          error_message: string
          id?: string
          task_event_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string
          id?: string
          task_event_id?: string | null
        }
        Relationships: []
      }
      enrichment_queue: {
        Row: {
          created_at: string
          id: string
          locked_at: string | null
          payload: Json
          processed_at: string | null
          scheduled_at: string
          status: string
          type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          locked_at?: string | null
          payload?: Json
          processed_at?: string | null
          scheduled_at?: string
          status?: string
          type: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          locked_at?: string | null
          payload?: Json
          processed_at?: string | null
          scheduled_at?: string
          status?: string
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_queue_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_links: {
        Row: {
          code: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          is_active: boolean
          max_uses: number
          used_count: number
          workspace_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          is_active?: boolean
          max_uses?: number
          used_count?: number
          workspace_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          is_active?: boolean
          max_uses?: number
          used_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "invite_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          last_active_workspace_id: string | null
          telegram_id: number
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id: string
          last_active_workspace_id?: string | null
          telegram_id: number
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          last_active_workspace_id?: string | null
          telegram_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "profiles_last_active_workspace_id_fkey"
            columns: ["last_active_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sprints: {
        Row: {
          capacity: number | null
          created_at: string
          end_date: string
          goal: string | null
          id: string
          name: string | null
          start_date: string
          status: string
          workspace_id: string
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          end_date: string
          goal?: string | null
          id?: string
          name?: string | null
          start_date: string
          status?: string
          workspace_id: string
        }
        Update: {
          capacity?: number | null
          created_at?: string
          end_date?: string
          goal?: string | null
          id?: string
          name?: string | null
          start_date?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sprints_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_column_history: {
        Row: {
          from_column: string | null
          id: string
          metadata: Json | null
          moved_at: string
          moved_by: string | null
          task_id: string
          task_version: number | null
          to_column: string
        }
        Insert: {
          from_column?: string | null
          id?: string
          metadata?: Json | null
          moved_at?: string
          moved_by?: string | null
          task_id: string
          task_version?: number | null
          to_column: string
        }
        Update: {
          from_column?: string | null
          id?: string
          metadata?: Json | null
          moved_at?: string
          moved_by?: string | null
          task_id?: string
          task_version?: number | null
          to_column?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_column_history_moved_by_fkey"
            columns: ["moved_by"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "task_column_history_moved_by_fkey"
            columns: ["moved_by"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_column_history_moved_by_fkey"
            columns: ["moved_by"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_column_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task1_id"]
          },
          {
            foreignKeyName: "task_column_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task2_id"]
          },
          {
            foreignKeyName: "task_column_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "orphan_blockers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_column_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "pending_escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_column_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "stale_blocked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_column_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "stuck_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_column_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_enrichments: {
        Row: {
          ai_hint: string | null
          anomaly: Json | null
          attempts: number
          cognitive_weight: number | null
          enriched_at: string | null
          enrichment_notes: string | null
          enrichment_status: string
          failed_at: string | null
          id: string
          last_attempt_at: string | null
          model_used: string | null
          requested_at: string | null
          sp_estimation_type: string | null
          story_points: number | null
          suggested_tags: string[] | null
          task_id: string
          workspace_id: string
        }
        Insert: {
          ai_hint?: string | null
          anomaly?: Json | null
          attempts?: number
          cognitive_weight?: number | null
          enriched_at?: string | null
          enrichment_notes?: string | null
          enrichment_status?: string
          failed_at?: string | null
          id?: string
          last_attempt_at?: string | null
          model_used?: string | null
          requested_at?: string | null
          sp_estimation_type?: string | null
          story_points?: number | null
          suggested_tags?: string[] | null
          task_id: string
          workspace_id: string
        }
        Update: {
          ai_hint?: string | null
          anomaly?: Json | null
          attempts?: number
          cognitive_weight?: number | null
          enriched_at?: string | null
          enrichment_notes?: string | null
          enrichment_status?: string
          failed_at?: string | null
          id?: string
          last_attempt_at?: string | null
          model_used?: string | null
          requested_at?: string | null
          sp_estimation_type?: string | null
          story_points?: number | null
          suggested_tags?: string[] | null
          task_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_enrichments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task1_id"]
          },
          {
            foreignKeyName: "task_enrichments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task2_id"]
          },
          {
            foreignKeyName: "task_enrichments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "orphan_blockers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_enrichments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "pending_escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_enrichments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "stale_blocked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_enrichments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "stuck_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_enrichments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_enrichments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_events: {
        Row: {
          consolidated: boolean
          created_at: string
          event_type: string
          id: string
          payload: Json
          task_id: string | null
          workspace_id: string
        }
        Insert: {
          consolidated?: boolean
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          task_id?: string | null
          workspace_id: string
        }
        Update: {
          consolidated?: boolean
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          task_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task1_id"]
          },
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task2_id"]
          },
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "orphan_blockers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "pending_escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "stale_blocked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "stuck_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_relations: {
        Row: {
          created_at: string
          created_by: string | null
          from_task_id: string
          id: string
          relation_type: string
          to_task_id: string
          weight: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_task_id: string
          id?: string
          relation_type: string
          to_task_id: string
          weight: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_task_id?: string
          id?: string
          relation_type?: string
          to_task_id?: string
          weight?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_relations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "task_relations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_from_task_id_fkey"
            columns: ["from_task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task1_id"]
          },
          {
            foreignKeyName: "task_relations_from_task_id_fkey"
            columns: ["from_task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task2_id"]
          },
          {
            foreignKeyName: "task_relations_from_task_id_fkey"
            columns: ["from_task_id"]
            isOneToOne: false
            referencedRelation: "orphan_blockers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_from_task_id_fkey"
            columns: ["from_task_id"]
            isOneToOne: false
            referencedRelation: "pending_escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_from_task_id_fkey"
            columns: ["from_task_id"]
            isOneToOne: false
            referencedRelation: "stale_blocked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_from_task_id_fkey"
            columns: ["from_task_id"]
            isOneToOne: false
            referencedRelation: "stuck_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_from_task_id_fkey"
            columns: ["from_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_to_task_id_fkey"
            columns: ["to_task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task1_id"]
          },
          {
            foreignKeyName: "task_relations_to_task_id_fkey"
            columns: ["to_task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task2_id"]
          },
          {
            foreignKeyName: "task_relations_to_task_id_fkey"
            columns: ["to_task_id"]
            isOneToOne: false
            referencedRelation: "orphan_blockers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_to_task_id_fkey"
            columns: ["to_task_id"]
            isOneToOne: false
            referencedRelation: "pending_escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_to_task_id_fkey"
            columns: ["to_task_id"]
            isOneToOne: false
            referencedRelation: "stale_blocked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_to_task_id_fkey"
            columns: ["to_task_id"]
            isOneToOne: false
            referencedRelation: "stuck_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_to_task_id_fkey"
            columns: ["to_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          clarity_score: number | null
          cognitive_weight: number
          column: string
          complexity: number | null
          created_at: string
          created_by: string | null
          deadline: string | null
          deadline_urgency: string | null
          description: string | null
          embedding: string | null
          embedding_hash: string | null
          embedding_updated_at: string | null
          enrichment_strategy: string | null
          escalation_reason: string | null
          handoff_notes: string | null
          handoff_to: string | null
          id: string
          is_blocked: boolean
          is_inbox: boolean
          metadata: Json
          moved_to_column_at: string | null
          needs_human: boolean
          position: number
          priority: string
          raw_input: string | null
          reviewer_id: string | null
          source: string | null
          sprint_id: string | null
          tags: string[]
          task_number: number | null
          title: string
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          clarity_score?: number | null
          cognitive_weight?: number
          column?: string
          complexity?: number | null
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          deadline_urgency?: string | null
          description?: string | null
          embedding?: string | null
          embedding_hash?: string | null
          embedding_updated_at?: string | null
          enrichment_strategy?: string | null
          escalation_reason?: string | null
          handoff_notes?: string | null
          handoff_to?: string | null
          id?: string
          is_blocked?: boolean
          is_inbox?: boolean
          metadata?: Json
          moved_to_column_at?: string | null
          needs_human?: boolean
          position?: number
          priority?: string
          raw_input?: string | null
          reviewer_id?: string | null
          source?: string | null
          sprint_id?: string | null
          tags?: string[]
          task_number?: number | null
          title: string
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          assigned_to?: string | null
          clarity_score?: number | null
          cognitive_weight?: number
          column?: string
          complexity?: number | null
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          deadline_urgency?: string | null
          description?: string | null
          embedding?: string | null
          embedding_hash?: string | null
          embedding_updated_at?: string | null
          enrichment_strategy?: string | null
          escalation_reason?: string | null
          handoff_notes?: string | null
          handoff_to?: string | null
          id?: string
          is_blocked?: boolean
          is_inbox?: boolean
          metadata?: Json
          moved_to_column_at?: string | null
          needs_human?: boolean
          position?: number
          priority?: string
          raw_input?: string | null
          reviewer_id?: string | null
          source?: string | null
          sprint_id?: string | null
          tags?: string[]
          task_number?: number | null
          title?: string
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_handoff_to_fkey"
            columns: ["handoff_to"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "tasks_handoff_to_fkey"
            columns: ["handoff_to"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_handoff_to_fkey"
            columns: ["handoff_to"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workers: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          role: string | null
          source_id: string
          type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          role?: string | null
          source_id: string
          type: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          role?: string | null
          source_id?: string
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_doc_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          meta_headers: Json | null
          workspace_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          meta_headers?: Json | null
          workspace_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          meta_headers?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_doc_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "workspace_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_doc_chunks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_documents: {
        Row: {
          checksum: string
          chunk_count: number
          created_at: string
          file_type: string | null
          filename: string
          id: string
          size_bytes: number
          status: string
          uploaded_by: string | null
          workspace_id: string
        }
        Insert: {
          checksum: string
          chunk_count?: number
          created_at?: string
          file_type?: string | null
          filename: string
          id?: string
          size_bytes: number
          status?: string
          uploaded_by?: string | null
          workspace_id: string
        }
        Update: {
          checksum?: string
          chunk_count?: number
          created_at?: string
          file_type?: string | null
          filename?: string
          id?: string
          size_bytes?: number
          status?: string
          uploaded_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workspace_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          url: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          url: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workspace_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          context_stale: boolean
          data_sharing_level: string
          deadline_signals: Json | null
          doc_kb_config: Json
          enable_cognitive_budget: boolean
          f04_config: Json
          flow_config: Json
          mcp_api_keys: Json
          quota_config: Json
          realtime_subscription_level: string
          standup_config: Json
          story_points_config: Json
          updated_at: string
          velocity_window_days: number
          workspace_context: string | null
          workspace_context_cache: string | null
          workspace_id: string
        }
        Insert: {
          context_stale?: boolean
          data_sharing_level?: string
          deadline_signals?: Json | null
          doc_kb_config?: Json
          enable_cognitive_budget?: boolean
          f04_config?: Json
          flow_config?: Json
          mcp_api_keys?: Json
          quota_config?: Json
          realtime_subscription_level?: string
          standup_config?: Json
          story_points_config?: Json
          updated_at?: string
          velocity_window_days?: number
          workspace_context?: string | null
          workspace_context_cache?: string | null
          workspace_id: string
        }
        Update: {
          context_stale?: boolean
          data_sharing_level?: string
          deadline_signals?: Json | null
          doc_kb_config?: Json
          enable_cognitive_budget?: boolean
          f04_config?: Json
          flow_config?: Json
          mcp_api_keys?: Json
          quota_config?: Json
          realtime_subscription_level?: string
          standup_config?: Json
          story_points_config?: Json
          updated_at?: string
          velocity_window_days?: number
          workspace_context?: string | null
          workspace_context_cache?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_task_counters: {
        Row: {
          last_number: number
          workspace_id: string
        }
        Insert: {
          last_number?: number
          workspace_id: string
        }
        Update: {
          last_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_task_counters_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_telegram_chats: {
        Row: {
          chat_id: number
          id: string
          is_active: boolean
          linked_at: string
          linked_by: string | null
          notification_settings: Json
          title: string | null
          workspace_id: string
        }
        Insert: {
          chat_id: number
          id?: string
          is_active?: boolean
          linked_at?: string
          linked_by?: string | null
          notification_settings?: Json
          title?: string | null
          workspace_id: string
        }
        Update: {
          chat_id?: number
          id?: string
          is_active?: boolean
          linked_at?: string
          linked_by?: string | null
          notification_settings?: Json
          title?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_telegram_chats_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_telegram_chats_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          plan: string
          slug: string
          task_prefix: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id?: string
          plan?: string
          slug: string
          task_prefix?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          plan?: string
          slug?: string
          task_prefix?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      attention_risk_pulse: {
        Row: {
          active_tasks: number | null
          attention_risk_score: number | null
          blocked_tasks: number | null
          context_switches_today: number | null
          critical_deadline_tasks: number | null
          display_name: string | null
          review_tasks: number | null
          risk_level: string | null
          worker_id: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bottleneck_columns: {
        Row: {
          column_name: string | null
          multiplier: number | null
          severity: string | null
          task_count: number | null
          wip_limit: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      duplicate_tasks: {
        Row: {
          similarity: number | null
          task1_id: string | null
          task2_id: string | null
          title1: string | null
          title2: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      handoff_chain: {
        Row: {
          column: string | null
          first_handoff_at: string | null
          handoff_count: number | null
          hours_in_chain: number | null
          last_handoff_at: string | null
          task_id: string | null
          title: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task1_id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "duplicate_tasks"
            referencedColumns: ["task2_id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "orphan_blockers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "pending_escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "stale_blocked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "stuck_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      orphan_blockers: {
        Row: {
          assigned_to: string | null
          assignee_name: string | null
          column: string | null
          hours_blocked: number | null
          id: string | null
          moved_to_column_at: string | null
          title: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      overloaded_workers: {
        Row: {
          display_name: string | null
          id: string | null
          threshold: number | null
          total_load: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_escalations: {
        Row: {
          assigned_agent: string | null
          escalation_reason: string | null
          hours_pending: number | null
          id: string | null
          moved_to_column_at: string | null
          title: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      review_backlog: {
        Row: {
          review_count: number | null
          reviewer_id: string | null
          reviewer_name: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stale_blocked: {
        Row: {
          assigned_to: string | null
          column: string | null
          id: string | null
          moved_to_column_at: string | null
          title: string | null
          workspace_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          column?: string | null
          id?: string | null
          moved_to_column_at?: string | null
          title?: string | null
          workspace_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          column?: string | null
          id?: string | null
          moved_to_column_at?: string | null
          title?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stuck_tasks: {
        Row: {
          assigned_to: string | null
          assignee_name: string | null
          column: string | null
          hours_stuck: number | null
          id: string | null
          moved_to_column_at: string | null
          title: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "attention_risk_pulse"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "overloaded_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      velocity_drop: {
        Row: {
          current_velocity: number | null
          previous_velocity: number | null
          ratio: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_worker_workspace_ids: { Args: never; Returns: string[] }
      accept_invite_link: {
        Args: { p_code: string }
        Returns: { workspace_id: string; invite_id: string }[]
      }
      create_invite_link: {
        Args: { p_workspace_id: string; p_created_by: string; p_code: string }
        Returns: { invite_id: string; code: string }[]
      }
      ensure_edge_fn_url: { Args: never; Returns: undefined }
      find_duplicate_tasks: {
        Args: {
          p_task_id: string
          p_threshold?: number
          p_title: string
          p_workspace_id: string
        }
        Returns: {
          id: string
          similarity: number
          title: string
        }[]
      }
      find_task_by_full_id: { Args: { p_full_id: string }; Returns: string }
      get_edge_fn_url: { Args: never; Returns: string }
      get_my_workspace_ids: { Args: never; Returns: string[] }
      get_task_subgraph: {
        Args: { p_task_id: string; p_workspace_id: string }
        Returns: {
          depth: number
          from_task_id: string
          relation_type: string
          to_task_id: string
          weight: number
        }[]
      }
      is_workspace_admin: { Args: { p_workspace_id: string }; Returns: boolean }
      is_workspace_owner: { Args: { p_workspace_id: string }; Returns: boolean }
      match_agent_memory: {
        Args: {
          match_count: number
          min_similarity: number
          p_workspace_id: string
          query_embedding: string
        }
        Returns: {
          memory_id: string
          period_start: string
          similarity: number
          summary_text: string
          task_id: string
        }[]
      }
      match_doc_chunks: {
        Args: {
          match_count: number
          min_similarity: number
          p_workspace_id: string
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          content: string
          filename: string
          meta_headers: Json
          similarity: number
        }[]
      }
      match_tasks: {
        Args: {
          exclude_task_id: string
          match_count: number
          min_similarity: number
          p_workspace_id: string
          query_embedding: string
        }
        Returns: {
          similarity: number
          task_id: string
        }[]
      }
      next_task_number: { Args: { p_workspace_id: string }; Returns: number }
      send_alert_immediate: {
        Args: {
          p_alert_type: string
          p_task_id: string
          p_text: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      task_full_id: { Args: { p_task_id: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const