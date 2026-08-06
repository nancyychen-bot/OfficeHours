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
      bookings: {
        Row: {
          attend_reasons: string | null
          booked_by_display_name: string | null
          booked_by_email: string | null
          booked_by_type: Database["public"]["Enums"]["booked_by_type"] | null
          challenge: string | null
          company: string | null
          created_at: string
          event_id: string
          experience_level: string | null
          guest_email: string
          guest_name: string
          guest_phone: string | null
          id: string
          last_synced_at: string | null
          last_synced_hash: string | null
          luma_guest_id: string | null
          luma_status: Database["public"]["Enums"]["luma_status"]
          notion_ambassador_page_id: string | null
          notion_dev_page_id: string | null
          notion_email: string | null
          notion_plan: string | null
          requested_slot: string | null
          role: string | null
          slot_id: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          attend_reasons?: string | null
          booked_by_display_name?: string | null
          booked_by_email?: string | null
          booked_by_type?: Database["public"]["Enums"]["booked_by_type"] | null
          challenge?: string | null
          company?: string | null
          created_at?: string
          event_id: string
          experience_level?: string | null
          guest_email: string
          guest_name: string
          guest_phone?: string | null
          id?: string
          last_synced_at?: string | null
          last_synced_hash?: string | null
          luma_guest_id?: string | null
          luma_status?: Database["public"]["Enums"]["luma_status"]
          notion_ambassador_page_id?: string | null
          notion_dev_page_id?: string | null
          notion_email?: string | null
          notion_plan?: string | null
          requested_slot?: string | null
          role?: string | null
          slot_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          attend_reasons?: string | null
          booked_by_display_name?: string | null
          booked_by_email?: string | null
          booked_by_type?: Database["public"]["Enums"]["booked_by_type"] | null
          challenge?: string | null
          company?: string | null
          created_at?: string
          event_id?: string
          experience_level?: string | null
          guest_email?: string
          guest_name?: string
          guest_phone?: string | null
          id?: string
          last_synced_at?: string | null
          last_synced_hash?: string | null
          luma_guest_id?: string | null
          luma_status?: Database["public"]["Enums"]["luma_status"]
          notion_ambassador_page_id?: string | null
          notion_dev_page_id?: string | null
          notion_email?: string | null
          notion_plan?: string | null
          requested_slot?: string | null
          role?: string | null
          slot_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      email_log: {
        Row: {
          booking_id: string
          created_at: string
          event_kind: string
          id: string
          recipient_email: string
          recipient_role: string
          resend_id: string | null
          status: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          event_kind: string
          id?: string
          recipient_email: string
          recipient_role: string
          resend_id?: string | null
          status: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          event_kind?: string
          id?: string
          recipient_email?: string
          recipient_role?: string
          resend_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          address: string | null
          city: string
          created_at: string
          event_date: string
          id: string
          luma_event_id: string | null
          name: string
          status: Database["public"]["Enums"]["event_status"]
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city: string
          created_at?: string
          event_date: string
          id?: string
          luma_event_id?: string | null
          name: string
          status?: Database["public"]["Enums"]["event_status"]
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string
          created_at?: string
          event_date?: string
          id?: string
          luma_event_id?: string | null
          name?: string
          status?: Database["public"]["Enums"]["event_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      slots: {
        Row: {
          capacity: number
          created_at: string
          ends_at: string
          event_id: string
          id: string
          name: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          ends_at: string
          event_id: string
          id?: string
          name: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          ends_at?: string
          event_id?: string
          id?: string
          name?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_log: {
        Row: {
          action: string | null
          booking_id: string | null
          created_at: string
          direction: Database["public"]["Enums"]["sync_direction"]
          id: number
          note: string | null
          payload: Json | null
          result: string
        }
        Insert: {
          action?: string | null
          booking_id?: string | null
          created_at?: string
          direction: Database["public"]["Enums"]["sync_direction"]
          id?: never
          note?: string | null
          payload?: Json | null
          result: string
        }
        Update: {
          action?: string | null
          booking_id?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["sync_direction"]
          id?: never
          note?: string | null
          payload?: Json | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      booking_details: {
        Row: {
          address: string | null
          attend_reasons: string | null
          booked_by_display_name: string | null
          booked_by_email: string | null
          booked_by_type: Database["public"]["Enums"]["booked_by_type"] | null
          challenge: string | null
          company: string | null
          created_at: string | null
          event_date: string | null
          event_id: string | null
          event_name: string | null
          experience_level: string | null
          guest_email: string | null
          guest_name: string | null
          guest_phone: string | null
          id: string | null
          last_synced_at: string | null
          last_synced_hash: string | null
          location: string | null
          luma_guest_id: string | null
          luma_status: Database["public"]["Enums"]["luma_status"] | null
          notion_ambassador_page_id: string | null
          notion_dev_page_id: string | null
          notion_email: string | null
          notion_plan: string | null
          requested_slot: string | null
          role: string | null
          slot_ends_at: string | null
          slot_id: string | null
          slot_name: string | null
          slot_starts_at: string | null
          status: Database["public"]["Enums"]["booking_status"] | null
          timezone: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      booked_by_type: "employee" | "ambassador"
      booking_status:
        | "unassigned"
        | "assigned"
        | "checked_in"
        | "no_show"
        | "cancelled"
        | "no_help_needed"
      event_status: "planned" | "live" | "completed" | "cancelled"
      luma_status: "pending" | "approved" | "waitlist" | "declined"
      sync_direction:
        | "luma_in"
        | "notion_dev_in"
        | "notion_amb_in"
        | "hub_to_dev"
        | "hub_to_amb"
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
      booked_by_type: ["employee", "ambassador"],
      booking_status: [
        "unassigned",
        "assigned",
        "checked_in",
        "no_show",
        "cancelled",
        "no_help_needed",
      ],
      event_status: ["planned", "live", "completed", "cancelled"],
      luma_status: ["pending", "approved", "waitlist", "declined"],
      sync_direction: [
        "luma_in",
        "notion_dev_in",
        "notion_amb_in",
        "hub_to_dev",
        "hub_to_amb",
      ],
    },
  },
} as const
