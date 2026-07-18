/**
 * Generated Supabase TypeScript Types
 * 
 * Generated via MCP Supabase execute_sql on 2026-07-14
 * Project: Onitask (atarmvtzvlwhkheeabeb)
 * 
 * To regenerate: use `npx supabase gen types typescript --linked` when Docker is available
 */

export type Json = string | number | boolean | object | readonly string[] | null

export interface Database {
  public: {
    Tables: {
      agent_events: {
        Row: {
          id: string
          workspace_id: string
          tool: string
          agent_name: string
          task_id: string | null
          summary: string | null
          metadata: Json
          state_before: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          tool: string
          agent_name: string
          task_id?: string | null
          summary?: string | null
          metadata?: Json
          state_before?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          tool?: string
          agent_name?: string
          task_id?: string | null
          summary?: string | null
          metadata?: Json
          state_before?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      agent_memory: {
        Row: {
          id: string
          workspace_id: string
          task_id: string | null
          summary_text: string | null
          embedding: number[] | null
          period_start: string | null
          period_end: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          task_id?: string | null
          summary_text?: string | null
          embedding?: number[] | null
          period_start?: string | null
          period_end?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          task_id?: string | null
          summary_text?: string | null
          embedding?: number[] | null
          period_start?: string | null
          period_end?: string | null
          created_at?: string
        }
        Relationships: []
      }
      assignment_history: {
        Row: {
          id: string
          workspace_id: string
          task_id: string | null
          assignee_id: string | null
          assigned_by: string | null
          snapshot_attention_risk: number | null
          snapshot_active_tasks: number | null
          snapshot_context_switches: number | null
          snapshot_blocked_tasks: number | null
          snapshot_review_tasks: number | null
          snapshot_critical_tasks: number | null
          outcome_status: string
          assigned_at: string
          resolved_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          task_id?: string | null
          assignee_id?: string | null
          assigned_by?: string | null
          snapshot_attention_risk?: number | null
          snapshot_active_tasks?: number | null
          snapshot_context_switches?: number | null
          snapshot_blocked_tasks?: number | null
          snapshot_review_tasks?: number | null
          snapshot_critical_tasks?: number | null
          outcome_status: string
          assigned_at?: string
          resolved_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          task_id?: string | null
          assignee_id?: string | null
          assigned_by?: string | null
          snapshot_attention_risk?: number | null
          snapshot_active_tasks?: number | null
          snapshot_context_switches?: number | null
          snapshot_blocked_tasks?: number | null
          snapshot_review_tasks?: number | null
          snapshot_critical_tasks?: number | null
          outcome_status?: string
          assigned_at?: string
          resolved_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      calendar_connections: {
        Row: {
          id: string
          workspace_id: string
          worker_id: string
          provider: string
          provider_account_email: string
          encrypted_oauth_tokens: string
          token_expires_at: string | null
          is_active: boolean
          connected_at: string
          last_sync_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          worker_id: string
          provider: string
          provider_account_email: string
          encrypted_oauth_tokens: string
          token_expires_at?: string | null
          is_active?: boolean
          connected_at?: string
          last_sync_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          worker_id?: string
          provider?: string
          provider_account_email?: string
          encrypted_oauth_tokens?: string
          token_expires_at?: string | null
          is_active?: boolean
          connected_at?: string
          last_sync_at?: string | null
        }
        Relationships: [
          { foreignKeyName: "calendar_connections_worker_id_fkey"; columns: ["worker_id"]; referencedRelation: "workers"; referencedColumns: ["id"] },
          { foreignKeyName: "calendar_connections_workspace_id_fkey"; columns: ["workspace_id"]; referencedRelation: "workspaces"; referencedColumns: ["id"] },
        ]
      }
      calendar_events: {
        Row: {
          id: string
          workspace_id: string
          provider: string
          remote_event_id: string
          title: string
          description: string | null
          start_at: string
          end_at: string
          reminder_minutes_before: number | null
          created_by: string | null
          updated_by: string | null
          source_synced_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          provider: string
          remote_event_id: string
          title: string
          description?: string | null
          start_at: string
          end_at: string
          reminder_minutes_before?: number | null
          created_by?: string | null
          updated_by?: string | null
          source_synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          provider?: string
          remote_event_id?: string
          title?: string
          description?: string | null
          start_at?: string
          end_at?: string
          reminder_minutes_before?: number | null
          created_by?: string | null
          updated_by?: string | null
          source_synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "calendar_events_created_by_fkey"; columns: ["created_by"]; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "calendar_events_updated_by_fkey"; columns: ["updated_by"]; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "calendar_events_workspace_id_fkey"; columns: ["workspace_id"]; referencedRelation: "workspaces"; referencedColumns: ["id"] },
        ]
      }
      consolidation_errors: {
        Row: {
          id: string
          task_event_id: string | null
          error_message: string
          created_at: string
        }
        Insert: {
          id?: string
          task_event_id?: string | null
          error_message: string
          created_at?: string
        }
        Update: {
          id?: string
          task_event_id?: string | null
          error_message?: string
          created_at?: string
        }
        Relationships: []
      }
      enrichment_queue: {
        Row: {
          id: string
          workspace_id: string
          type: string
          payload: Json
          status: string
          scheduled_at: string
          created_at: string
          processed_at: string | null
          locked_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          type: string
          payload: Json
          status?: string
          scheduled_at?: string
          created_at?: string
          processed_at?: string | null
          locked_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          type?: string
          payload?: Json
          status?: string
          scheduled_at?: string
          created_at?: string
          processed_at?: string | null
          locked_at?: string | null
        }
        Relationships: []
      }
      invite_links: {
        Row: {
          id: string
          workspace_id: string
          code: string
          created_by: string
          expires_at: string
          max_uses: number
          used_count: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          code: string
          created_by: string
          expires_at?: string
          max_uses?: number
          used_count?: number
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          code?: string
          created_by?: string
          expires_at?: string
          max_uses?: number
          used_count?: number
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          telegram_id: number
          display_name: string
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          telegram_id: number
          display_name: string
          avatar_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          telegram_id?: number
          display_name?: string
          avatar_url?: string | null
          created_at?: string
        }
        Relationships: []
      }
      sprints: {
        Row: {
          id: string
          workspace_id: string
          name: string | null
          start_date: string
          end_date: string
          capacity: number | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name?: string | null
          start_date: string
          end_date: string
          capacity?: number | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          name?: string | null
          start_date?: string
          end_date?: string
          capacity?: number | null
          status?: string
          created_at?: string
        }
        Relationships: []
      }
      task_column_history: {
        Row: {
          id: string
          task_id: string
          from_column: string | null
          to_column: string
          moved_by: string | null
          task_version: number | null
          metadata: Json | null
          moved_at: string
        }
        Insert: {
          id?: string
          task_id: string
          from_column?: string | null
          to_column: string
          moved_by?: string | null
          task_version?: number | null
          metadata?: Json | null
          moved_at?: string
        }
        Update: {
          id?: string
          task_id?: string
          from_column?: string | null
          to_column?: string
          moved_by?: string | null
          task_version?: number | null
          metadata?: Json | null
          moved_at?: string
        }
        Relationships: []
      }
      task_enrichments: {
        Row: {
          id: string
          task_id: string
          workspace_id: string
          anomaly: Json | null
          ai_hint: string | null
          cognitive_weight: number | null
          story_points: number | null
          sp_estimation_type: string | null
          suggested_tags: string[] | null
          enrichment_status: string
          enrichment_notes: string | null
          model_used: string | null
          enriched_at: string | null
          failed_at: string | null
          attempts: number
          last_attempt_at: string | null
          requested_at: string | null
        }
        Insert: {
          id?: string
          task_id: string
          workspace_id: string
          anomaly?: Json | null
          ai_hint?: string | null
          cognitive_weight?: number | null
          story_points?: number | null
          sp_estimation_type?: string | null
          suggested_tags?: string[] | null
          enrichment_status?: string
          enrichment_notes?: string | null
          model_used?: string | null
          enriched_at?: string | null
          failed_at?: string | null
          attempts?: number
          last_attempt_at?: string | null
          requested_at?: string | null
        }
        Update: {
          id?: string
          task_id?: string
          workspace_id?: string
          anomaly?: Json | null
          ai_hint?: string | null
          cognitive_weight?: number | null
          story_points?: number | null
          sp_estimation_type?: string | null
          suggested_tags?: string[] | null
          enrichment_status?: string
          enrichment_notes?: string | null
          model_used?: string | null
          enriched_at?: string | null
          failed_at?: string | null
          attempts?: number
          last_attempt_at?: string | null
          requested_at?: string | null
        }
        Relationships: []
      }
      task_events: {
        Row: {
          id: string
          workspace_id: string
          task_id: string | null
          event_type: string
          payload: Json
          consolidated: boolean
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          task_id?: string | null
          event_type: string
          payload: Json
          consolidated?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          task_id?: string | null
          event_type?: string
          payload?: Json
          consolidated?: boolean
          created_at?: string
        }
        Relationships: []
      }
      task_relations: {
        Row: {
          id: string
          workspace_id: string
          from_task_id: string
          to_task_id: string
          relation_type: string
          weight: number
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          from_task_id: string
          to_task_id: string
          relation_type: string
          weight?: number
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          from_task_id?: string
          to_task_id?: string
          relation_type?: string
          weight?: number
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          id: string
          workspace_id: string
          task_number: number | null
          title: string
          description: string | null
          tags: string[]
          column: string
          priority: string
          deadline: string | null
          deadline_urgency: string | null
          is_inbox: boolean
          is_blocked: boolean
          needs_human: boolean
          escalation_reason: string | null
          assigned_to: string | null
          reviewer_id: string | null
          handoff_to: string | null
          handoff_notes: string | null
          sprint_id: string | null
          cognitive_weight: number
          raw_input: string | null
          clarity_score: number | null
          complexity: number | null
          enrichment_strategy: string | null
          embedding: number[] | null
          embedding_hash: string | null
          embedding_updated_at: string | null
          version: number
          moved_to_column_at: string | null
          position: number
          source: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          task_number?: number | null
          title: string
          description?: string | null
          tags?: string[]
          column?: string
          priority?: string
          deadline?: string | null
          deadline_urgency?: string | null
          is_inbox?: boolean
          is_blocked?: boolean
          needs_human?: boolean
          escalation_reason?: string | null
          assigned_to?: string | null
          reviewer_id?: string | null
          handoff_to?: string | null
          handoff_notes?: string | null
          sprint_id?: string | null
          cognitive_weight?: number
          raw_input?: string | null
          clarity_score?: number | null
          complexity?: number | null
          enrichment_strategy?: string | null
          embedding?: number[] | null
          embedding_hash?: string | null
          embedding_updated_at?: string | null
          version?: number
          moved_to_column_at?: string | null
          position?: number
          source?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          task_number?: number | null
          title?: string
          description?: string | null
          tags?: string[]
          column?: string
          priority?: string
          deadline?: string | null
          deadline_urgency?: string | null
          is_inbox?: boolean
          is_blocked?: boolean
          needs_human?: boolean
          escalation_reason?: string | null
          assigned_to?: string | null
          reviewer_id?: string | null
          handoff_to?: string | null
          handoff_notes?: string | null
          sprint_id?: string | null
          cognitive_weight?: number
          raw_input?: string | null
          clarity_score?: number | null
          complexity?: number | null
          enrichment_strategy?: string | null
          embedding?: number[] | null
          embedding_hash?: string | null
          embedding_updated_at?: string | null
          version?: number
          moved_to_column_at?: string | null
          position?: number
          source?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      workers: {
        Row: {
          id: string
          workspace_id: string
          type: string
          role: string | null
          display_name: string
          source_id: string
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          type: string
          role?: string | null
          display_name: string
          source_id: string
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          type?: string
          role?: string | null
          display_name?: string
          source_id?: string
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      workspace_doc_chunks: {
        Row: {
          id: string
          document_id: string
          workspace_id: string
          chunk_index: number
          content: string
          meta_headers: Json | null
          embedding: number[] | null
          created_at: string
        }
        Insert: {
          id?: string
          document_id: string
          workspace_id: string
          chunk_index: number
          content: string
          meta_headers?: Json | null
          embedding?: number[] | null
          created_at?: string
        }
        Update: {
          id?: string
          document_id?: string
          workspace_id?: string
          chunk_index?: number
          content?: string
          meta_headers?: Json | null
          embedding?: number[] | null
          created_at?: string
        }
        Relationships: []
      }
      workspace_documents: {
        Row: {
          id: string
          workspace_id: string
          filename: string
          file_type: string | null
          size_bytes: number
          checksum: string
          chunk_count: number
          status: string
          uploaded_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          filename: string
          file_type?: string | null
          size_bytes: number
          checksum: string
          chunk_count?: number
          status?: string
          uploaded_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          filename?: string
          file_type?: string | null
          size_bytes?: number
          checksum?: string
          chunk_count?: number
          status?: string
          uploaded_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      workspace_settings: {
        Row: {
          workspace_id: string
          enable_cognitive_budget: boolean
          story_points_config: Json
          velocity_window_days: number
          flow_config: Json
          realtime_subscription_level: string
          workspace_context: string | null
          workspace_context_cache: string | null
          context_stale: boolean
          standup_config: Json
          doc_kb_config: Json
          f04_config: Json
          quota_config: Json
          data_sharing_level: string
          mcp_api_keys: Json
          updated_at: string
        }
        Insert: {
          workspace_id: string
          enable_cognitive_budget?: boolean
          story_points_config?: Json
          velocity_window_days?: number
          flow_config?: Json
          realtime_subscription_level?: string
          workspace_context?: string | null
          workspace_context_cache?: string | null
          context_stale?: boolean
          standup_config?: Json
          doc_kb_config?: Json
          f04_config?: Json
          quota_config?: Json
          data_sharing_level?: string
          mcp_api_keys?: Json
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          enable_cognitive_budget?: boolean
          story_points_config?: Json
          velocity_window_days?: number
          flow_config?: Json
          realtime_subscription_level?: string
          workspace_context?: string | null
          workspace_context_cache?: string | null
          context_stale?: boolean
          standup_config?: Json
          doc_kb_config?: Json
          f04_config?: Json
          quota_config?: Json
          data_sharing_level?: string
          mcp_api_keys?: Json
          updated_at?: string
        }
        Relationships: []
      }
      workspace_task_counters: {
        Row: {
          workspace_id: string
          last_number: number
        }
        Insert: {
          workspace_id: string
          last_number: number
        }
        Update: {
          workspace_id?: string
          last_number?: number
        }
        Relationships: []
      }
      workspace_telegram_chats: {
        Row: {
          id: string
          workspace_id: string
          chat_id: number
          title: string | null
          is_active: boolean
          notification_settings: Json
          linked_by: string | null
          linked_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          chat_id: number
          title?: string | null
          is_active?: boolean
          notification_settings?: Json
          linked_by?: string | null
          linked_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          chat_id?: number
          title?: string | null
          is_active?: boolean
          notification_settings?: Json
          linked_by?: string | null
          linked_at?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          id: string
          name: string
          slug: string
          plan: string
          task_prefix: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          plan?: string
          task_prefix?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          plan?: string
          task_prefix?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      attention_risk_pulse: {
        Row: {
          worker_id: string | null
          display_name: string | null
          workspace_id: string | null
          active_tasks: number | null
          context_switches_today: number | null
          blocked_tasks: number | null
          review_tasks: number | null
          critical_deadline_tasks: number | null
          attention_risk_score: number | null
          risk_level: string | null
        }
        Insert: {
          worker_id?: string | null
          display_name?: string | null
          workspace_id?: string | null
          active_tasks?: number | null
          context_switches_today?: number | null
          blocked_tasks?: number | null
          review_tasks?: number | null
          critical_deadline_tasks?: number | null
          attention_risk_score?: number | null
          risk_level?: string | null
        }
        Update: {
          worker_id?: string | null
          display_name?: string | null
          workspace_id?: string | null
          active_tasks?: number | null
          context_switches_today?: number | null
          blocked_tasks?: number | null
          review_tasks?: number | null
          critical_deadline_tasks?: number | null
          attention_risk_score?: number | null
          risk_level?: string | null
        }
        Relationships: []
      }
      bottleneck_columns: {
        Row: {
          workspace_id: string | null
          column_name: string | null
          wip_limit: number | null
          multiplier: number | null
          task_count: number | null
          severity: string | null
        }
        Insert: {
          workspace_id?: string | null
          column_name?: string | null
          wip_limit?: number | null
          multiplier?: number | null
          task_count?: number | null
          severity?: string | null
        }
        Update: {
          workspace_id?: string | null
          column_name?: string | null
          wip_limit?: number | null
          multiplier?: number | null
          task_count?: number | null
          severity?: string | null
        }
        Relationships: []
      }
      duplicate_tasks: {
        Row: {
          task1_id: string | null
          title1: string | null
          task2_id: string | null
          title2: string | null
          similarity: number | null
          workspace_id: string | null
        }
        Insert: {
          task1_id?: string | null
          title1?: string | null
          task2_id?: string | null
          title2?: string | null
          similarity?: number | null
          workspace_id?: string | null
        }
        Update: {
          task1_id?: string | null
          title1?: string | null
          task2_id?: string | null
          title2?: string | null
          similarity?: number | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      handoff_chain: {
        Row: {
          task_id: string | null
          title: string | null
          workspace_id: string | null
          column: string | null
          handoff_count: number | null
          first_handoff_at: string | null
          last_handoff_at: string | null
          hours_in_chain: number | null
        }
        Insert: {
          task_id?: string | null
          title?: string | null
          workspace_id?: string | null
          column?: string | null
          handoff_count?: number | null
          first_handoff_at?: string | null
          last_handoff_at?: string | null
          hours_in_chain?: number | null
        }
        Update: {
          task_id?: string | null
          title?: string | null
          workspace_id?: string | null
          column?: string | null
          handoff_count?: number | null
          first_handoff_at?: string | null
          last_handoff_at?: string | null
          hours_in_chain?: number | null
        }
        Relationships: []
      }
      orphan_blockers: {
        Row: {
          id: string | null
          title: string | null
          column: string | null
          workspace_id: string | null
          assigned_to: string | null
          assignee_name: string | null
          moved_to_column_at: string | null
          hours_blocked: number | null
        }
        Insert: {
          id?: string | null
          title?: string | null
          column?: string | null
          workspace_id?: string | null
          assigned_to?: string | null
          assignee_name?: string | null
          moved_to_column_at?: string | null
          hours_blocked?: number | null
        }
        Update: {
          id?: string | null
          title?: string | null
          column?: string | null
          workspace_id?: string | null
          assigned_to?: string | null
          assignee_name?: string | null
          moved_to_column_at?: string | null
          hours_blocked?: number | null
        }
        Relationships: []
      }
      overloaded_workers: {
        Row: {
          id: string | null
          display_name: string | null
          workspace_id: string | null
          total_load: number | null
          threshold: number | null
        }
        Insert: {
          id?: string | null
          display_name?: string | null
          workspace_id?: string | null
          total_load?: number | null
          threshold?: number | null
        }
        Update: {
          id?: string | null
          display_name?: string | null
          workspace_id?: string | null
          total_load?: number | null
          threshold?: number | null
        }
        Relationships: []
      }
      pending_escalations: {
        Row: {
          id: string | null
          title: string | null
          escalation_reason: string | null
          workspace_id: string | null
          assigned_agent: string | null
          moved_to_column_at: string | null
          hours_pending: number | null
        }
        Insert: {
          id?: string | null
          title?: string | null
          escalation_reason?: string | null
          workspace_id?: string | null
          assigned_agent?: string | null
          moved_to_column_at?: string | null
          hours_pending?: number | null
        }
        Update: {
          id?: string | null
          title?: string | null
          escalation_reason?: string | null
          workspace_id?: string | null
          assigned_agent?: string | null
          moved_to_column_at?: string | null
          hours_pending?: number | null
        }
        Relationships: []
      }
      review_backlog: {
        Row: {
          reviewer_id: string | null
          reviewer_name: string | null
          review_count: number | null
          workspace_id: string | null
        }
        Insert: {
          reviewer_id?: string | null
          reviewer_name?: string | null
          review_count?: number | null
          workspace_id?: string | null
        }
        Update: {
          reviewer_id?: string | null
          reviewer_name?: string | null
          review_count?: number | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      stale_blocked: {
        Row: {
          id: string | null
          title: string | null
          column: string | null
          assigned_to: string | null
          workspace_id: string | null
          moved_to_column_at: string | null
        }
        Insert: {
          id?: string | null
          title?: string | null
          column?: string | null
          assigned_to?: string | null
          workspace_id?: string | null
          moved_to_column_at?: string | null
        }
        Update: {
          id?: string | null
          title?: string | null
          column?: string | null
          assigned_to?: string | null
          workspace_id?: string | null
          moved_to_column_at?: string | null
        }
        Relationships: []
      }
      stuck_tasks: {
        Row: {
          id: string | null
          title: string | null
          column: string | null
          assigned_to: string | null
          assignee_name: string | null
          moved_to_column_at: string | null
          hours_stuck: number | null
          workspace_id: string | null
        }
        Insert: {
          id?: string | null
          title?: string | null
          column?: string | null
          assigned_to?: string | null
          assignee_name?: string | null
          moved_to_column_at?: string | null
          hours_stuck?: number | null
          workspace_id?: string | null
        }
        Update: {
          id?: string | null
          title?: string | null
          column?: string | null
          assigned_to?: string | null
          assignee_name?: string | null
          moved_to_column_at?: string | null
          hours_stuck?: number | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      velocity_drop: {
        Row: {
          workspace_id: string | null
          current_velocity: number | null
          previous_velocity: number | null
          ratio: number | null
        }
        Insert: {
          workspace_id?: string | null
          current_velocity?: number | null
          previous_velocity?: number | null
          ratio?: number | null
        }
        Update: {
          workspace_id?: string | null
          current_velocity?: number | null
          previous_velocity?: number | null
          ratio?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, 'public'>]

export type Tables<
  TableName extends keyof PublicSchema['Tables']
> = PublicSchema['Tables'][TableName]

export type Views<
  TableName extends keyof PublicSchema['Views']
> = PublicSchema['Views'][TableName]

export type Inserts<
  TableName extends keyof PublicSchema['Tables']
> = PublicSchema['Tables'][TableName]['Insert']

export type Updates<
  TableName extends keyof PublicSchema['Tables']
> = PublicSchema['Tables'][TableName]['Update']

export type Rows<
  TableName extends keyof PublicSchema['Tables']
> = PublicSchema['Tables'][TableName]['Row']

export type ViewRows<
  TableName extends keyof PublicSchema['Views']
> = PublicSchema['Views'][TableName]['Row']