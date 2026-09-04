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
      agenda_settings: {
        Row: {
          barbershop_id: string
          business_hours: Json
          distribution_mode: string
          hide_professional_selection: boolean
          online_booking_enabled: boolean
          priority_order: string[]
          public_slug: string | null
          slot_duration_minutes: number
          updated_at: string
        }
        Insert: {
          barbershop_id: string
          business_hours?: Json
          distribution_mode?: string
          hide_professional_selection?: boolean
          online_booking_enabled?: boolean
          priority_order?: string[]
          public_slug?: string | null
          slot_duration_minutes?: number
          updated_at?: string
        }
        Update: {
          barbershop_id?: string
          business_hours?: Json
          distribution_mode?: string
          hide_professional_selection?: boolean
          online_booking_enabled?: boolean
          priority_order?: string[]
          public_slug?: string | null
          slot_duration_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_settings_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: true
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_ia_settings: {
        Row: {
          id: boolean
          sales_video_url: string | null
          updated_at: string
        }
        Insert: {
          id?: boolean
          sales_video_url?: string | null
          updated_at?: string
        }
        Update: {
          id?: boolean
          sales_video_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_demo_leads: {
        Row: {
          barbershop_id: string | null
          created_at: string
          goal: string | null
          id: string
          name: string
          phone: string
          revenue_range: string | null
          segment: string | null
          status: string
        }
        Insert: {
          barbershop_id?: string | null
          created_at?: string
          goal?: string | null
          id?: string
          name: string
          phone: string
          revenue_range?: string | null
          segment?: string | null
          status?: string
        }
        Update: {
          barbershop_id?: string | null
          created_at?: string
          goal?: string | null
          id?: string
          name?: string
          phone?: string
          revenue_range?: string | null
          segment?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_demo_leads_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          barbershop_id: string
          created_at: string
          customer_id: string | null
          duration_minutes: number
          id: string
          notes: string | null
          price: number | null
          professional_id: string | null
          scheduled_at: string
          service_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          barbershop_id: string
          created_at?: string
          customer_id?: string | null
          duration_minutes?: number
          id?: string
          notes?: string | null
          price?: number | null
          professional_id?: string | null
          scheduled_at: string
          service_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          barbershop_id?: string
          created_at?: string
          customer_id?: string | null
          duration_minutes?: number
          id?: string
          notes?: string | null
          price?: number | null
          professional_id?: string | null
          scheduled_at?: string
          service_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      barbershop_members: {
        Row: {
          barbershop_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          barbershop_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          barbershop_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "barbershop_members_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      barbershops: {
        Row: {
          ai_access_enabled: boolean
          business_type: string
          created_at: string
          created_by: string | null
          id: string
          logo_url: string | null
          name: string
          owner_email: string | null
          owner_name: string | null
          owner_phone: string | null
          updated_at: string
        }
        Insert: {
          ai_access_enabled?: boolean
          business_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name: string
          owner_email?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          updated_at?: string
        }
        Update: {
          ai_access_enabled?: boolean
          business_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          owner_email?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      campaign_targets: {
        Row: {
          barbershop_id: string
          campaign_id: string
          customer_id: string
          id: string
          status: string
        }
        Insert: {
          barbershop_id: string
          campaign_id: string
          customer_id: string
          id?: string
          status?: string
        }
        Update: {
          barbershop_id?: string
          campaign_id?: string
          customer_id?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_targets_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_targets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_reminder_rules: {
        Row: {
          active: boolean
          applies_to_statuses: string[]
          barbershop_id: string
          confirm_button_text: string | null
          confirm_keywords: string[]
          created_at: string
          id: string
          kind: string
          message_text: string | null
          name: string
          offset_minutes: number
          template_header_media_path: string | null
          template_language: string | null
          template_name: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          applies_to_statuses?: string[]
          barbershop_id: string
          confirm_button_text?: string | null
          confirm_keywords?: string[]
          created_at?: string
          id?: string
          kind: string
          message_text?: string | null
          name: string
          offset_minutes: number
          template_header_media_path?: string | null
          template_language?: string | null
          template_name?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          applies_to_statuses?: string[]
          barbershop_id?: string
          confirm_button_text?: string | null
          confirm_keywords?: string[]
          created_at?: string
          id?: string
          kind?: string
          message_text?: string | null
          name?: string
          offset_minutes?: number
          template_header_media_path?: string | null
          template_language?: string | null
          template_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_reminder_rules_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_reminder_sent_log: {
        Row: {
          appointment_id: string
          id: string
          message_job_id: string | null
          rule_id: string
          sent_at: string
        }
        Insert: {
          appointment_id: string
          id?: string
          message_job_id?: string | null
          rule_id: string
          sent_at?: string
        }
        Update: {
          appointment_id?: string
          id?: string
          message_job_id?: string | null
          rule_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_reminder_sent_log_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_reminder_sent_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "agenda_reminder_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_followup_rules: {
        Row: {
          active: boolean
          barbershop_id: string
          created_at: string
          funnel_id: string
          id: string
          stage_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          barbershop_id: string
          created_at?: string
          funnel_id: string
          id?: string
          stage_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          barbershop_id?: string
          created_at?: string
          funnel_id?: string
          id?: string
          stage_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_followup_rules_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_followup_rules_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_followup_steps: {
        Row: {
          actions: Json
          created_at: string
          delay_minutes: number
          id: string
          rule_id: string
          skip_if_replied: boolean
          sort_order: number
          template_header_media_path: string | null
          template_language: string | null
          template_name: string | null
        }
        Insert: {
          actions?: Json
          created_at?: string
          delay_minutes: number
          id?: string
          rule_id: string
          skip_if_replied?: boolean
          sort_order?: number
          template_header_media_path?: string | null
          template_language?: string | null
          template_name?: string | null
        }
        Update: {
          actions?: Json
          created_at?: string
          delay_minutes?: number
          id?: string
          rule_id?: string
          skip_if_replied?: boolean
          sort_order?: number
          template_header_media_path?: string | null
          template_language?: string | null
          template_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_followup_steps_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "funnel_followup_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_followup_sent_log: {
        Row: {
          card_id: string
          id: string
          message_job_id: string | null
          sent_at: string
          step_id: string
        }
        Insert: {
          card_id: string
          id?: string
          message_job_id?: string | null
          sent_at?: string
          step_id: string
        }
        Update: {
          card_id?: string
          id?: string
          message_job_id?: string | null
          sent_at?: string
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_followup_sent_log_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "funnel_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_followup_sent_log_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "funnel_followup_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_meta_connections: {
        Row: {
          claimed_at: string | null
          claimed_barbershop_id: string | null
          created_at: string
          id: string
          is_coexistence: boolean
          meta_access_token: string
          meta_business_id: string | null
          phone: string | null
          phone_number_id: string
          updated_at: string
          waba_id: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_barbershop_id?: string | null
          created_at?: string
          id?: string
          is_coexistence?: boolean
          meta_access_token: string
          meta_business_id?: string | null
          phone?: string | null
          phone_number_id: string
          updated_at?: string
          waba_id: string
        }
        Update: {
          claimed_at?: string | null
          claimed_barbershop_id?: string | null
          created_at?: string
          id?: string
          is_coexistence?: boolean
          meta_access_token?: string
          meta_business_id?: string | null
          phone?: string | null
          phone_number_id?: string
          updated_at?: string
          waba_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_meta_connections_claimed_barbershop_id_fkey"
            columns: ["claimed_barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience_filter: Json
          barbershop_id: string
          created_at: string
          created_by: string | null
          id: string
          message_actions: Json
          message_variants: string[]
          name: string
          pace_seconds: number
          pace_seconds_max: number | null
          pace_seconds_min: number | null
          scheduled_for: string | null
          status: string
          template_carousel_media_paths: string[] | null
          template_header_media_path: string | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          audience_filter?: Json
          barbershop_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          message_actions?: Json
          message_variants?: string[]
          name: string
          pace_seconds?: number
          pace_seconds_max?: number | null
          pace_seconds_min?: number | null
          scheduled_for?: string | null
          status?: string
          template_carousel_media_paths?: string[] | null
          template_header_media_path?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          audience_filter?: Json
          barbershop_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          message_actions?: Json
          message_variants?: string[]
          name?: string
          pace_seconds?: number
          pace_seconds_max?: number | null
          pace_seconds_min?: number | null
          scheduled_for?: string | null
          status?: string
          template_carousel_media_paths?: string[] | null
          template_header_media_path?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_deals: {
        Row: {
          barbershop_id: string
          company: string | null
          created_at: string
          entry_date: string | null
          exit_date: string | null
          id: string
          lead_source: string | null
          notes: string | null
          phone: string | null
          products_of_interest: string | null
          role: string | null
          stage_label: string | null
          state: string | null
          updated_at: string
          value_cents: number | null
          wa_contact_id: string | null
        }
        Insert: {
          barbershop_id: string
          company?: string | null
          created_at?: string
          entry_date?: string | null
          exit_date?: string | null
          id?: string
          lead_source?: string | null
          notes?: string | null
          phone?: string | null
          products_of_interest?: string | null
          role?: string | null
          stage_label?: string | null
          state?: string | null
          updated_at?: string
          value_cents?: number | null
          wa_contact_id?: string | null
        }
        Update: {
          barbershop_id?: string
          company?: string | null
          created_at?: string
          entry_date?: string | null
          exit_date?: string | null
          id?: string
          lead_source?: string | null
          notes?: string | null
          phone?: string | null
          products_of_interest?: string | null
          role?: string | null
          stage_label?: string | null
          state?: string | null
          updated_at?: string
          value_cents?: number | null
          wa_contact_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_deals_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_deals_wa_contact_id_fkey"
            columns: ["wa_contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_profiles: {
        Row: {
          ai_summary: string | null
          ai_summary_updated_at: string | null
          avatar_url: string | null
          barbershop_id: string
          birth_date: string | null
          city: string | null
          country: string | null
          created_at: string
          email: string | null
          gender: string | null
          id: string
          language: string | null
          name: string | null
          phone: string | null
          updated_at: string
          wa_contact_id: string | null
        }
        Insert: {
          ai_summary?: string | null
          ai_summary_updated_at?: string | null
          avatar_url?: string | null
          barbershop_id: string
          birth_date?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          gender?: string | null
          id?: string
          language?: string | null
          name?: string | null
          phone?: string | null
          updated_at?: string
          wa_contact_id?: string | null
        }
        Update: {
          ai_summary?: string | null
          ai_summary_updated_at?: string | null
          avatar_url?: string | null
          barbershop_id?: string
          birth_date?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          gender?: string | null
          id?: string
          language?: string | null
          name?: string | null
          phone?: string | null
          updated_at?: string
          wa_contact_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_profiles_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_profiles_wa_contact_id_fkey"
            columns: ["wa_contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      dental_procedures: {
        Row: {
          appointment_id: string | null
          barbershop_id: string
          created_at: string
          customer_id: string
          id: string
          notes: string | null
          paid: boolean
          performed_at: string
          price_cents: number
          procedure_type: string
          tooth_number: number | null
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          barbershop_id: string
          created_at?: string
          customer_id: string
          id?: string
          notes?: string | null
          paid?: boolean
          performed_at?: string
          price_cents?: number
          procedure_type: string
          tooth_number?: number | null
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          barbershop_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          notes?: string | null
          paid?: boolean
          performed_at?: string
          price_cents?: number
          procedure_type?: string
          tooth_number?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dental_procedures_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dental_procedures_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dental_procedures_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      dental_charts: {
        Row: {
          barbershop_id: string
          chart_data: Json
          customer_id: string
          id: string
          updated_at: string
        }
        Insert: {
          barbershop_id: string
          chart_data?: Json
          customer_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          barbershop_id?: string
          chart_data?: Json
          customer_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dental_charts_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dental_charts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          ai_summary: string | null
          ai_summary_updated_at: string | null
          archived_at: string | null
          barbershop_id: string
          birth_date: string | null
          created_at: string
          email: string | null
          id: string
          is_subscriber: boolean
          name: string
          notes: string | null
          phone: string
          source: string
          spreadsheet_batch_id: string | null
          status: string
          subscription_price_cents: number | null
          subscription_started_at: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          address?: string | null
          ai_summary?: string | null
          ai_summary_updated_at?: string | null
          archived_at?: string | null
          barbershop_id: string
          birth_date?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_subscriber?: boolean
          name: string
          notes?: string | null
          phone: string
          source?: string
          spreadsheet_batch_id?: string | null
          status?: string
          subscription_price_cents?: number | null
          subscription_started_at?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          address?: string | null
          ai_summary?: string | null
          ai_summary_updated_at?: string | null
          archived_at?: string | null
          barbershop_id?: string
          birth_date?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_subscriber?: boolean
          name?: string
          notes?: string | null
          phone?: string
          source?: string
          spreadsheet_batch_id?: string | null
          status?: string
          subscription_price_cents?: number | null
          subscription_started_at?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      extension_tokens: {
        Row: {
          barbershop_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          label: string
          last_used_at: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          barbershop_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          barbershop_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "extension_tokens_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_cards: {
        Row: {
          barbershop_id: string
          created_at: string
          customer_id: string | null
          funnel_id: string
          id: string
          notes: string | null
          phone: string | null
          sort_order: number
          stage_entered_at: string
          stage_id: string
          title: string
          updated_at: string
          value_cents: number | null
          wa_contact_id: string | null
        }
        Insert: {
          barbershop_id: string
          created_at?: string
          customer_id?: string | null
          funnel_id: string
          id?: string
          notes?: string | null
          phone?: string | null
          sort_order?: number
          stage_entered_at?: string
          stage_id: string
          title: string
          updated_at?: string
          value_cents?: number | null
          wa_contact_id?: string | null
        }
        Update: {
          barbershop_id?: string
          created_at?: string
          customer_id?: string | null
          funnel_id?: string
          id?: string
          notes?: string | null
          phone?: string | null
          sort_order?: number
          stage_entered_at?: string
          stage_id?: string
          title?: string
          updated_at?: string
          value_cents?: number | null
          wa_contact_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_cards_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_cards_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_cards_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_cards_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "funnel_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_cards_wa_contact_id_fkey"
            columns: ["wa_contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_stages: {
        Row: {
          barbershop_id: string
          color: string | null
          created_at: string
          funnel_id: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          barbershop_id: string
          color?: string | null
          created_at?: string
          funnel_id: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          barbershop_id?: string
          color?: string | null
          created_at?: string
          funnel_id?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_stages_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_stages_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      funnels: {
        Row: {
          barbershop_id: string
          created_at: string
          id: string
          mode: string
          name: string
          sort_order: number
          source_label_id: string | null
          updated_at: string
        }
        Insert: {
          barbershop_id: string
          created_at?: string
          id?: string
          mode?: string
          name: string
          sort_order?: number
          source_label_id?: string | null
          updated_at?: string
        }
        Update: {
          barbershop_id?: string
          created_at?: string
          id?: string
          mode?: string
          name?: string
          sort_order?: number
          source_label_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnels_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      health_events: {
        Row: {
          barbershop_id: string
          created_at: string
          details: Json
          id: string
          kind: string
          severity: string
        }
        Insert: {
          barbershop_id: string
          created_at?: string
          details?: Json
          id?: string
          kind: string
          severity?: string
        }
        Update: {
          barbershop_id?: string
          created_at?: string
          details?: Json
          id?: string
          kind?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_events_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          body: Json | null
          created_at: string
          headers: Json | null
          id: string
          kind: string
          method: string
          note: string | null
          source: string
          status_code: number
        }
        Insert: {
          body?: Json | null
          created_at?: string
          headers?: Json | null
          id?: string
          kind: string
          method: string
          note?: string | null
          source?: string
          status_code: number
        }
        Update: {
          body?: Json | null
          created_at?: string
          headers?: Json | null
          id?: string
          kind?: string
          method?: string
          note?: string | null
          source?: string
          status_code?: number
        }
        Relationships: []
      }
      lead_notes: {
        Row: {
          barbershop_id: string
          body: string | null
          created_at: string
          created_by: string | null
          id: string
          media_filename: string | null
          media_mime: string | null
          media_path: string | null
          media_url: string | null
          phone: string | null
          wa_contact_id: string | null
        }
        Insert: {
          barbershop_id: string
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_path?: string | null
          media_url?: string | null
          phone?: string | null
          wa_contact_id?: string | null
        }
        Update: {
          barbershop_id?: string
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_path?: string | null
          media_url?: string | null
          phone?: string | null
          wa_contact_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_notes_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_wa_contact_id_fkey"
            columns: ["wa_contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          featured: boolean
          id: string
          module_id: string | null
          sort_order: number
          title: string
          updated_at: string
          youtube_url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          featured?: boolean
          id?: string
          module_id?: string | null
          sort_order?: number
          title: string
          updated_at?: string
          youtube_url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          featured?: boolean
          id?: string
          module_id?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
          youtube_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      message_jobs: {
        Row: {
          agenda_reminder_rule_id: string | null
          appointment_id: string | null
          attempts: number
          barbershop_id: string
          campaign_id: string | null
          claimed_at: string | null
          claimed_by_token: string | null
          created_at: string
          customer_id: string
          expires_at: string | null
          force_extension: boolean
          funnel_followup_step_id: string | null
          id: string
          last_error: string | null
          max_attempts: number
          message_actions: Json
          phone: string
          provider_message_id: string | null
          rendered_body: string
          scheduled_for: string
          sent_at: string | null
          status: string
          template_carousel_media_paths: string[] | null
          template_header_media_path: string | null
          template_language: string | null
          template_name: string | null
          updated_at: string
        }
        Insert: {
          agenda_reminder_rule_id?: string | null
          appointment_id?: string | null
          attempts?: number
          barbershop_id: string
          campaign_id?: string | null
          claimed_at?: string | null
          claimed_by_token?: string | null
          created_at?: string
          customer_id: string
          expires_at?: string | null
          force_extension?: boolean
          funnel_followup_step_id?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          message_actions?: Json
          phone: string
          provider_message_id?: string | null
          rendered_body: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          template_carousel_media_paths?: string[] | null
          template_header_media_path?: string | null
          template_language?: string | null
          template_name?: string | null
          updated_at?: string
        }
        Update: {
          agenda_reminder_rule_id?: string | null
          appointment_id?: string | null
          attempts?: number
          barbershop_id?: string
          campaign_id?: string | null
          claimed_at?: string | null
          claimed_by_token?: string | null
          created_at?: string
          customer_id?: string
          expires_at?: string | null
          force_extension?: boolean
          funnel_followup_step_id?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          message_actions?: Json
          phone?: string
          provider_message_id?: string | null
          rendered_body?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          template_carousel_media_paths?: string[] | null
          template_header_media_path?: string | null
          template_language?: string | null
          template_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_jobs_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          barbershop_id: string
          body: string
          category: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          barbershop_id: string
          body: string
          category?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          barbershop_id?: string
          body?: string
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          barbershop_id: string
          category: string | null
          created_at: string
          formula_calculo: Json | null
          id: string
          link_catalogo: string | null
          mensagem_apresentacao: string | null
          moeda: string
          motivo_escalar: string | null
          name: string
          observacoes_regras_especiais: string | null
          palavras_chave_negativas: string[]
          palavras_chave_positivas: string[]
          pedido_minimo: string | null
          price: number | null
          produto_alternativo_sugerido: string | null
          roteiro_atendimento: Json | null
          sempre_escalar_humano: boolean
          sort_order: number
          tabela_precos: Json | null
          tipo_precificacao: Database["public"]["Enums"]["product_pricing_type"]
          updated_at: string
          variaveis_obrigatorias: string[]
        }
        Insert: {
          active?: boolean
          barbershop_id: string
          category?: string | null
          created_at?: string
          formula_calculo?: Json | null
          id?: string
          link_catalogo?: string | null
          mensagem_apresentacao?: string | null
          moeda?: string
          motivo_escalar?: string | null
          name: string
          observacoes_regras_especiais?: string | null
          palavras_chave_negativas?: string[]
          palavras_chave_positivas?: string[]
          pedido_minimo?: string | null
          price?: number | null
          produto_alternativo_sugerido?: string | null
          roteiro_atendimento?: Json | null
          sempre_escalar_humano?: boolean
          sort_order?: number
          tabela_precos?: Json | null
          tipo_precificacao?: Database["public"]["Enums"]["product_pricing_type"]
          updated_at?: string
          variaveis_obrigatorias?: string[]
        }
        Update: {
          active?: boolean
          barbershop_id?: string
          category?: string | null
          created_at?: string
          formula_calculo?: Json | null
          id?: string
          link_catalogo?: string | null
          mensagem_apresentacao?: string | null
          moeda?: string
          motivo_escalar?: string | null
          name?: string
          observacoes_regras_especiais?: string | null
          palavras_chave_negativas?: string[]
          palavras_chave_positivas?: string[]
          pedido_minimo?: string | null
          price?: number | null
          produto_alternativo_sugerido?: string | null
          roteiro_atendimento?: Json | null
          sempre_escalar_humano?: boolean
          sort_order?: number
          tabela_precos?: Json | null
          tipo_precificacao?: Database["public"]["Enums"]["product_pricing_type"]
          updated_at?: string
          variaveis_obrigatorias?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "products_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_produto_alternativo_sugerido_fkey"
            columns: ["produto_alternativo_sugerido"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_services: {
        Row: {
          professional_id: string
          service_id: string
        }
        Insert: {
          professional_id: string
          service_id: string
        }
        Update: {
          professional_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_services_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      professionals: {
        Row: {
          active: boolean
          avatar_url: string | null
          barbershop_id: string
          bio: string | null
          color: string
          commission_percent: number | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          barbershop_id: string
          bio?: string | null
          color?: string
          commission_percent?: number | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          barbershop_id?: string
          bio?: string | null
          color?: string
          commission_percent?: number | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professionals_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_replies: {
        Row: {
          actions: Json
          barbershop_id: string
          category_id: string | null
          created_at: string
          id: string
          is_favorite: boolean
          shortcut: string | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          actions?: Json
          barbershop_id: string
          category_id?: string | null
          created_at?: string
          id?: string
          is_favorite?: boolean
          shortcut?: string | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          actions?: Json
          barbershop_id?: string
          category_id?: string | null
          created_at?: string
          id?: string
          is_favorite?: boolean
          shortcut?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_replies_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_replies_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "quick_reply_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_reply_categories: {
        Row: {
          barbershop_id: string
          color: string
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          barbershop_id: string
          color?: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          barbershop_id?: string
          color?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "quick_reply_categories_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean
          barbershop_id: string
          category: string | null
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          name: string
          price: number | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          barbershop_id: string
          category?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          name: string
          price?: number | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          barbershop_id?: string
          category?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          name?: string
          price?: number | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_subscriptions: {
        Row: {
          barbershop_id: string
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          price_id: string | null
          product_id: string | null
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
        }
        Insert: {
          barbershop_id: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
        }
        Update: {
          barbershop_id?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_subscriptions_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      time_blocks: {
        Row: {
          barbershop_id: string
          created_at: string
          ends_at: string
          id: string
          professional_id: string | null
          reason: string | null
          starts_at: string
        }
        Insert: {
          barbershop_id: string
          created_at?: string
          ends_at: string
          id?: string
          professional_id?: string | null
          reason?: string | null
          starts_at: string
        }
        Update: {
          barbershop_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          professional_id?: string | null
          reason?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_blocks_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_blocks_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      training_modules: {
        Row: {
          active: boolean
          cover_image_url: string | null
          created_at: string
          description: string | null
          id: string
          locked: boolean
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          locked?: boolean
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          locked?: boolean
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      wa_contacts: {
        Row: {
          barbershop_id: string
          created_at: string
          customer_id: string | null
          id: string
          is_group: boolean
          label_ids: string[]
          last_message_at: string | null
          name: string | null
          phone: string | null
          profile_picture_url: string | null
          synced_at: string
          unread_count: number
          updated_at: string
          wa_id: string
        }
        Insert: {
          barbershop_id: string
          created_at?: string
          customer_id?: string | null
          id?: string
          is_group?: boolean
          label_ids?: string[]
          last_message_at?: string | null
          name?: string | null
          phone?: string | null
          profile_picture_url?: string | null
          synced_at?: string
          unread_count?: number
          updated_at?: string
          wa_id: string
        }
        Update: {
          barbershop_id?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          is_group?: boolean
          label_ids?: string[]
          last_message_at?: string | null
          name?: string | null
          phone?: string | null
          profile_picture_url?: string | null
          synced_at?: string
          unread_count?: number
          updated_at?: string
          wa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_contacts_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_labels: {
        Row: {
          barbershop_id: string
          color: string | null
          conversation_count: number
          created_at: string
          id: string
          name: string
          synced_at: string
          updated_at: string
          wa_label_id: string
        }
        Insert: {
          barbershop_id: string
          color?: string | null
          conversation_count?: number
          created_at?: string
          id?: string
          name: string
          synced_at?: string
          updated_at?: string
          wa_label_id: string
        }
        Update: {
          barbershop_id?: string
          color?: string | null
          conversation_count?: number
          created_at?: string
          id?: string
          name?: string
          synced_at?: string
          updated_at?: string
          wa_label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_labels_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: false
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          barbershop_id: string
          created_at: string
          id: string
          instance_id: string | null
          instance_token: string | null
          is_coexistence: boolean
          last_error: string | null
          last_qr: string | null
          last_synced_at: string | null
          meta_access_token: string | null
          meta_business_id: string | null
          phone: string | null
          phone_number_id: string | null
          provider: string
          shared_with_ai: boolean
          status: string
          uazapi_instance_id: string | null
          uazapi_instance_token: string | null
          updated_at: string
          waba_id: string | null
        }
        Insert: {
          barbershop_id: string
          created_at?: string
          id?: string
          instance_id?: string | null
          instance_token?: string | null
          is_coexistence?: boolean
          last_error?: string | null
          last_qr?: string | null
          last_synced_at?: string | null
          meta_access_token?: string | null
          meta_business_id?: string | null
          phone?: string | null
          phone_number_id?: string | null
          provider?: string
          shared_with_ai?: boolean
          status?: string
          uazapi_instance_id?: string | null
          uazapi_instance_token?: string | null
          updated_at?: string
          waba_id?: string | null
        }
        Update: {
          barbershop_id?: string
          created_at?: string
          id?: string
          instance_id?: string | null
          instance_token?: string | null
          is_coexistence?: boolean
          last_error?: string | null
          last_qr?: string | null
          last_synced_at?: string | null
          meta_access_token?: string | null
          meta_business_id?: string | null
          phone?: string | null
          phone_number_id?: string | null
          provider?: string
          shared_with_ai?: boolean
          status?: string
          uazapi_instance_id?: string | null
          uazapi_instance_token?: string | null
          updated_at?: string
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_barbershop_id_fkey"
            columns: ["barbershop_id"]
            isOneToOne: true
            referencedRelation: "barbershops"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_barbershop_role: {
        Args: {
          _barbershop_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_barbershop_member: {
        Args: { _barbershop_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "owner" | "staff"
      product_pricing_type: "fixo" | "tabela_faixa" | "formula_area"
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
    Enums: {
      app_role: ["owner", "staff"],
      product_pricing_type: ["fixo", "tabela_faixa", "formula_area"],
    },
  },
} as const
