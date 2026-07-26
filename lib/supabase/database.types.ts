/**
 * GENERATED FILE - DO NOT EDIT BY HAND.
 * Source: supabase/customizer_v2.sql
 * Generator: npm run generate:customizer:types
 *
 * This checked-in snapshot makes the Customizer V2 database contract available
 * without a live project. Before a production deployment, regenerate the full
 * project types with the Supabase CLI and reconcile any intentional differences.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      product_customizer_templates: {
        Row: {
          id: string
          product_id: string
          enabled: boolean
          version: number
          engine: string
          canvas_width_px: number
          canvas_height_px: number
          card_width_in: number | null
          card_height_in: number | null
          dpi: number
          orientation: string
          default_page: string
          pages: Json
          fields: Json
          layers: Json
          safe_area: Json
          bleed: Json
          assets: Json
          settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          product_id: string
          enabled?: boolean
          version?: number
          engine?: string
          canvas_width_px?: number
          canvas_height_px?: number
          card_width_in?: number | null
          card_height_in?: number | null
          dpi?: number
          orientation?: string
          default_page?: string
          pages?: Json
          fields?: Json
          layers?: Json
          safe_area?: Json
          bleed?: Json
          assets?: Json
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          product_id?: string
          enabled?: boolean
          version?: number
          engine?: string
          canvas_width_px?: number
          canvas_height_px?: number
          card_width_in?: number | null
          card_height_in?: number | null
          dpi?: number
          orientation?: string
          default_page?: string
          pages?: Json
          fields?: Json
          layers?: Json
          safe_area?: Json
          bleed?: Json
          assets?: Json
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_customizations: {
        Row: {
          id: string
          user_id: string | null
          product_id: string | null
          template_id: string | null
          cart_item_id: string | null
          order_id: string | null
          template_version: number
          status: string
          values: Json
          uploaded_files: Json
          selected_options: Json
          preview_images: Json
          render_data: Json
          print_files: Json
          created_at: string
          updated_at: string
          asset_references: Json
        }
        Insert: {
          id?: string
          user_id?: string | null
          product_id?: string | null
          template_id?: string | null
          cart_item_id?: string | null
          order_id?: string | null
          template_version?: number
          status?: string
          values?: Json
          uploaded_files?: Json
          selected_options?: Json
          preview_images?: Json
          render_data?: Json
          print_files?: Json
          created_at?: string
          updated_at?: string
          asset_references?: Json
        }
        Update: {
          id?: string
          user_id?: string | null
          product_id?: string | null
          template_id?: string | null
          cart_item_id?: string | null
          order_id?: string | null
          template_version?: number
          status?: string
          values?: Json
          uploaded_files?: Json
          selected_options?: Json
          preview_images?: Json
          render_data?: Json
          print_files?: Json
          created_at?: string
          updated_at?: string
          asset_references?: Json
        }
        Relationships: []
      }
      customizer_template_versions: {
        Row: {
          id: string
          template_id: string
          product_id: string | null
          version: number
          schema_version: number
          engine_version: string
          document: Json
          font_dependencies: Json
          published_by: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          template_id: string
          product_id?: string | null
          version: number
          schema_version?: number
          engine_version?: string
          document?: Json
          font_dependencies?: Json
          published_by?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          template_id?: string
          product_id?: string | null
          version?: number
          schema_version?: number
          engine_version?: string
          document?: Json
          font_dependencies?: Json
          published_by?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      customizer_asset_categories: {
        Row: {
          id: string
          name: string
          slug: string
          description: string | null
          sort_order: number
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          description?: string | null
          sort_order?: number
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          description?: string | null
          sort_order?: number
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      customizer_assets: {
        Row: {
          id: string
          category_id: string | null
          title: string
          tags: string
          keywords: string | null
          bucket: string
          path: string
          public_url: string | null
          mime_type: string
          file_size_bytes: number
          width: number
          height: number
          tintable: boolean
          default_color: string | null
          customer_available: boolean
          active: boolean
          archived: boolean
          checksum: string | null
          metadata: Json
          created_by: string | null
          created_at: string
          updated_at: string
          original_filename: string | null
          asset_type: string
          thumbnail_path: string | null
          editor_path: string | null
          folder_id: string | null
          admin_available: boolean
          status: string
          usage_count: number
        }
        Insert: {
          id?: string
          category_id?: string | null
          title: string
          tags?: string
          keywords?: string | null
          bucket?: string
          path: string
          public_url?: string | null
          mime_type: string
          file_size_bytes?: number
          width?: number
          height?: number
          tintable?: boolean
          default_color?: string | null
          customer_available?: boolean
          active?: boolean
          archived?: boolean
          checksum?: string | null
          metadata?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
          original_filename?: string | null
          asset_type?: string
          thumbnail_path?: string | null
          editor_path?: string | null
          folder_id?: string | null
          admin_available?: boolean
          status?: string
          usage_count?: number
        }
        Update: {
          id?: string
          category_id?: string | null
          title?: string
          tags?: string
          keywords?: string | null
          bucket?: string
          path?: string
          public_url?: string | null
          mime_type?: string
          file_size_bytes?: number
          width?: number
          height?: number
          tintable?: boolean
          default_color?: string | null
          customer_available?: boolean
          active?: boolean
          archived?: boolean
          checksum?: string | null
          metadata?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
          original_filename?: string | null
          asset_type?: string
          thumbnail_path?: string | null
          editor_path?: string | null
          folder_id?: string | null
          admin_available?: boolean
          status?: string
          usage_count?: number
        }
        Relationships: []
      }
      customer_asset_library: {
        Row: {
          id: string
          user_id: string
          bucket: string
          path: string
          thumbnail_path: string | null
          editor_path: string | null
          file_name: string
          mime_type: string
          size_bytes: number
          width: number
          height: number
          checksum: string | null
          status: string
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          bucket?: string
          path: string
          thumbnail_path?: string | null
          editor_path?: string | null
          file_name: string
          mime_type: string
          size_bytes?: number
          width?: number
          height?: number
          checksum?: string | null
          status?: string
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          bucket?: string
          path?: string
          thumbnail_path?: string | null
          editor_path?: string | null
          file_name?: string
          mime_type?: string
          size_bytes?: number
          width?: number
          height?: number
          checksum?: string | null
          status?: string
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      customizer_mockup_templates: {
        Row: {
          id: string
          product_id: string | null
          name: string
          view: string
          config: Json
          sort_order: number
          active: boolean
          created_at: string
          updated_at: string
          product_type: string
          version: number
          status: string
        }
        Insert: {
          id?: string
          product_id?: string | null
          name: string
          view?: string
          config?: Json
          sort_order?: number
          active?: boolean
          created_at?: string
          updated_at?: string
          product_type?: string
          version?: number
          status?: string
        }
        Update: {
          id?: string
          product_id?: string | null
          name?: string
          view?: string
          config?: Json
          sort_order?: number
          active?: boolean
          created_at?: string
          updated_at?: string
          product_type?: string
          version?: number
          status?: string
        }
        Relationships: []
      }
      customizer_mockup_views: {
        Row: {
          id: string
          mockup_template_id: string
          name: string
          base_image_asset_id: string | null
          base_image_url: string | null
          width: number
          height: number
          sort_order: number
          active: boolean
          created_at: string
          updated_at: string
          requires_transparency: boolean
        }
        Insert: {
          id?: string
          mockup_template_id: string
          name: string
          base_image_asset_id?: string | null
          base_image_url?: string | null
          width?: number
          height?: number
          sort_order?: number
          active?: boolean
          created_at?: string
          updated_at?: string
          requires_transparency?: boolean
        }
        Update: {
          id?: string
          mockup_template_id?: string
          name?: string
          base_image_asset_id?: string | null
          base_image_url?: string | null
          width?: number
          height?: number
          sort_order?: number
          active?: boolean
          created_at?: string
          updated_at?: string
          requires_transparency?: boolean
        }
        Relationships: []
      }
      customizer_mockup_artwork_areas: {
        Row: {
          id: string
          mockup_view_id: string
          source_page_id: string
          x: number
          y: number
          width: number
          height: number
          rotation: number
          clip_path: string | null
          perspective_points: Json | null
          warp_type: string
          opacity: number
          blend_mode: string | null
          sort_order: number
          created_at: string
          updated_at: string
          visible: boolean
          locked: boolean
        }
        Insert: {
          id?: string
          mockup_view_id: string
          source_page_id: string
          x: number
          y: number
          width: number
          height: number
          rotation?: number
          clip_path?: string | null
          perspective_points?: Json | null
          warp_type?: string
          opacity?: number
          blend_mode?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
          visible?: boolean
          locked?: boolean
        }
        Update: {
          id?: string
          mockup_view_id?: string
          source_page_id?: string
          x?: number
          y?: number
          width?: number
          height?: number
          rotation?: number
          clip_path?: string | null
          perspective_points?: Json | null
          warp_type?: string
          opacity?: number
          blend_mode?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
          visible?: boolean
          locked?: boolean
        }
        Relationships: []
      }
      customizer_mockup_overlays: {
        Row: {
          id: string
          mockup_view_id: string
          asset_id: string | null
          src: string | null
          overlay_type: string
          opacity: number
          blend_mode: string | null
          sort_order: number
          created_at: string
          visible: boolean
          locked: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          mockup_view_id: string
          asset_id?: string | null
          src?: string | null
          overlay_type: string
          opacity?: number
          blend_mode?: string | null
          sort_order?: number
          created_at?: string
          visible?: boolean
          locked?: boolean
          updated_at?: string
        }
        Update: {
          id?: string
          mockup_view_id?: string
          asset_id?: string | null
          src?: string | null
          overlay_type?: string
          opacity?: number
          blend_mode?: string | null
          sort_order?: number
          created_at?: string
          visible?: boolean
          locked?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      customizer_guides: {
        Row: {
          id: string
          template_id: string
          page_id: string
          orientation: string
          position: number
          created_at: string
          locked: boolean
          hidden: boolean
          customer_visible: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          template_id: string
          page_id: string
          orientation: string
          position: number
          created_at?: string
          locked?: boolean
          hidden?: boolean
          customer_visible?: boolean
          updated_at?: string
        }
        Update: {
          id?: string
          template_id?: string
          page_id?: string
          orientation?: string
          position?: number
          created_at?: string
          locked?: boolean
          hidden?: boolean
          customer_visible?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      customizer_render_jobs: {
        Row: {
          id: string
          customization_id: string | null
          order_id: string | null
          template_version_id: string | null
          job_type: string
          status: string
          attempt_count: number
          priority: number
          input_hash: string
          input_snapshot: Json
          error_code: string | null
          error_message: string | null
          started_at: string | null
          completed_at: string | null
          created_at: string
          updated_at: string
          locked_by: string | null
          lock_token: string | null
          lock_expires_at: string | null
          heartbeat_at: string | null
          next_attempt_at: string | null
          cancel_requested_at: string | null
        }
        Insert: {
          id?: string
          customization_id?: string | null
          order_id?: string | null
          template_version_id?: string | null
          job_type: string
          status?: string
          attempt_count?: number
          priority?: number
          input_hash: string
          input_snapshot?: Json
          error_code?: string | null
          error_message?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
          locked_by?: string | null
          lock_token?: string | null
          lock_expires_at?: string | null
          heartbeat_at?: string | null
          next_attempt_at?: string | null
          cancel_requested_at?: string | null
        }
        Update: {
          id?: string
          customization_id?: string | null
          order_id?: string | null
          template_version_id?: string | null
          job_type?: string
          status?: string
          attempt_count?: number
          priority?: number
          input_hash?: string
          input_snapshot?: Json
          error_code?: string | null
          error_message?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
          locked_by?: string | null
          lock_token?: string | null
          lock_expires_at?: string | null
          heartbeat_at?: string | null
          next_attempt_at?: string | null
          cancel_requested_at?: string | null
        }
        Relationships: []
      }
      customizer_render_outputs: {
        Row: {
          id: string
          job_id: string
          customization_id: string | null
          page_id: string
          format: string
          bucket: string
          path: string
          width_px: number
          height_px: number
          dpi: number
          file_size_bytes: number
          checksum: string | null
          watermarked: boolean
          created_at: string
          render_engine_version: string | null
          template_version: number | null
          metadata: Json
          order_id: string | null
          mockup_version: number | null
          output_type: string | null
          mime_type: string | null
          input_hash: string | null
          status: string
          expires_at: string | null
          verified_at: string | null
        }
        Insert: {
          id?: string
          job_id: string
          customization_id?: string | null
          page_id: string
          format: string
          bucket?: string
          path: string
          width_px?: number
          height_px?: number
          dpi?: number
          file_size_bytes?: number
          checksum?: string | null
          watermarked?: boolean
          created_at?: string
          render_engine_version?: string | null
          template_version?: number | null
          metadata?: Json
          order_id?: string | null
          mockup_version?: number | null
          output_type?: string | null
          mime_type?: string | null
          input_hash?: string | null
          status?: string
          expires_at?: string | null
          verified_at?: string | null
        }
        Update: {
          id?: string
          job_id?: string
          customization_id?: string | null
          page_id?: string
          format?: string
          bucket?: string
          path?: string
          width_px?: number
          height_px?: number
          dpi?: number
          file_size_bytes?: number
          checksum?: string | null
          watermarked?: boolean
          created_at?: string
          render_engine_version?: string | null
          template_version?: number | null
          metadata?: Json
          order_id?: string | null
          mockup_version?: number | null
          output_type?: string | null
          mime_type?: string | null
          input_hash?: string | null
          status?: string
          expires_at?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      customizer_preflight_results: {
        Row: {
          id: string
          customization_id: string | null
          order_id: string | null
          context: string
          ok: boolean
          blocking: boolean
          issues: Json
          created_at: string
        }
        Insert: {
          id?: string
          customization_id?: string | null
          order_id?: string | null
          context?: string
          ok?: boolean
          blocking?: boolean
          issues?: Json
          created_at?: string
        }
        Update: {
          id?: string
          customization_id?: string | null
          order_id?: string | null
          context?: string
          ok?: boolean
          blocking?: boolean
          issues?: Json
          created_at?: string
        }
        Relationships: []
      }
      order_design_snapshots: {
        Row: {
          id: string
          order_id: string
          order_item_id: string | null
          customization_id: string | null
          product_id: string | null
          product_title: string | null
          product_sku: string | null
          quantity: number
          selected_options: Json
          pricing: Json
          template_id: string | null
          template_version: number
          template_version_id: string | null
          snapshot: Json
          preflight: Json
          preview_files: Json
          print_files: Json
          render_status: string
          integrity_hash: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          order_id: string
          order_item_id?: string | null
          customization_id?: string | null
          product_id?: string | null
          product_title?: string | null
          product_sku?: string | null
          quantity?: number
          selected_options?: Json
          pricing?: Json
          template_id?: string | null
          template_version?: number
          template_version_id?: string | null
          snapshot?: Json
          preflight?: Json
          preview_files?: Json
          print_files?: Json
          render_status?: string
          integrity_hash?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          order_item_id?: string | null
          customization_id?: string | null
          product_id?: string | null
          product_title?: string | null
          product_sku?: string | null
          quantity?: number
          selected_options?: Json
          pricing?: Json
          template_id?: string | null
          template_version?: number
          template_version_id?: string | null
          snapshot?: Json
          preflight?: Json
          preview_files?: Json
          print_files?: Json
          render_status?: string
          integrity_hash?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      customizer_feature_flags: {
        Row: {
          id: string
          product_id: string | null
          enabled: boolean
          created_at: string
          updated_at: string
          scope: string
          scope_key: string | null
          product_type: string | null
          environments: string
          rollout_percentage: number
          admin_only: boolean
          metadata: Json
        }
        Insert: {
          id?: string
          product_id?: string | null
          enabled?: boolean
          created_at?: string
          updated_at?: string
          scope?: string
          scope_key?: string | null
          product_type?: string | null
          environments?: string
          rollout_percentage?: number
          admin_only?: boolean
          metadata?: Json
        }
        Update: {
          id?: string
          product_id?: string | null
          enabled?: boolean
          created_at?: string
          updated_at?: string
          scope?: string
          scope_key?: string | null
          product_type?: string | null
          environments?: string
          rollout_percentage?: number
          admin_only?: boolean
          metadata?: Json
        }
        Relationships: []
      }
      customizer_audit_logs: {
        Row: {
          id: string
          actor_id: string | null
          customization_id: string | null
          product_id: string | null
          action: string
          layer_ids: string
          details: Json
          created_at: string
        }
        Insert: {
          id?: string
          actor_id?: string | null
          customization_id?: string | null
          product_id?: string | null
          action: string
          layer_ids?: string
          details?: Json
          created_at?: string
        }
        Update: {
          id?: string
          actor_id?: string | null
          customization_id?: string | null
          product_id?: string | null
          action?: string
          layer_ids?: string
          details?: Json
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type CustomizerTableName = keyof Database["public"]["Tables"]
export type CustomizerRow<Table extends CustomizerTableName> = Database["public"]["Tables"][Table]["Row"]
export type CustomizerInsert<Table extends CustomizerTableName> = Database["public"]["Tables"][Table]["Insert"]
export type CustomizerUpdate<Table extends CustomizerTableName> = Database["public"]["Tables"][Table]["Update"]
