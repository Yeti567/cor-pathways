export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type TenantScopedTable =
  | "users"
  | "permission_profiles"
  | "locations"
  | "equipment"
  | "equipment_meter_log"
  | "equipment_maintenance_log"
  | "equipment_scheduled_service"
  | "equipment_submission_link"
  | "equipment_document"
  | "transport_driver"
  | "transport_document"
  | "transport_medical_record"
  | "user_locations"
  | "visitors"
  | "worker_time_cards"
  | "worker_profiles"
  | "certification_types"
  | "certifications"
  | "lists"
  | "list_items"
  | "forms"
  | "form_sections"
  | "form_items"
  | "submissions"
  | "submission_values"
  | "signatures"
  | "submission_photos"
  | "resources"
  | "resource_sections"
  | "document_control_register"
  | "workflows"
  | "workflow_steps"
  | "workflow_conditions"
  | "workflow_runs"
  | "workflow_run_steps"
  | "follow_ups"
  | "schedules"
  | "scheduled_tasks"
  | "auto_share_recipients"
  | "notifications"
  | "company_settings"
  | "print_settings";

type TenantScopedRow = {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at?: string;
};

type CoProjectRow = TenantScopedRow & {
  name: string;
  client_name: string | null;
  contract_number: string | null;
  original_contract_value: number;
  status: "active" | "closed";
  notes: string | null;
  created_by: string | null;
  deleted_at: string | null;
};

type ChangeOrderRow = TenantScopedRow & {
  project_id: string;
  number: number;
  title: string;
  description: string | null;
  origin: "owner_request" | "field_condition" | "design_clarification" | "rfi" | "other";
  status: "draft" | "submitted" | "approved" | "rejected" | "void";
  schedule_impact_days: number;
  total_amount: number;
  approved_by: string | null;
  approved_at: string | null;
  approved_signer_name: string | null;
  created_by: string | null;
  deleted_at: string | null;
};

type ChangeOrderApprovalRow = TenantScopedRow & {
  change_order_id: string;
  decision: "submitted" | "approved" | "rejected" | "reopened" | "voided";
  decided_by: string | null;
  decided_by_name: string | null;
  signer_name: string | null;
  note: string | null;
};

type ChangeOrderAttachmentRow = TenantScopedRow & {
  change_order_id: string;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
};

type FieldTicketRow = TenantScopedRow & {
  project_id: string | null;
  title: string;
  description: string | null;
  estimated_amount: number;
  photo_path: string | null;
  status: "open" | "promoted" | "dismissed";
  change_order_id: string | null;
  submitted_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

type ChangeOrderLineRow = TenantScopedRow & {
  change_order_id: string;
  category: "labor" | "material" | "equipment" | "subcontractor" | "other";
  description: string;
  quantity: number;
  unit: string | null;
  unit_cost: number;
  amount: number;
  sort_order: number;
};

type ChangeOrderMarkupRow = TenantScopedRow & {
  change_order_id: string;
  label: string;
  percent: number | null;
  amount: number;
  sort_order: number;
};

type TransportDriverRow = TenantScopedRow & {
  user_id: string | null;
  full_name: string;
  license_number: string | null;
  license_class: string | null;
  license_expiry: string | null;
  hired_on: string | null;
  status: "active" | "inactive";
  hos_cycle: "cycle_1" | "cycle_2";
  hos_regime: "federal" | "provincial_ab";
  notes: string | null;
  created_by: string | null;
  deleted_at: string | null;
};

type TransportDutyStatusEventRow = TenantScopedRow & {
  driver_id: string;
  status: "off_duty" | "sleeper_berth" | "driving" | "on_duty";
  started_at: string;
  source: "manual" | "eld" | "edit" | "time_record" | "ocr";
  location: string | null;
  remark: string | null;
  created_by: string | null;
};

export type EldProvider = "motive" | "samsara" | "geotab" | "isaac";

type EldConnectionRow = TenantScopedRow & {
  provider: EldProvider;
  status: "needs_setup" | "connected" | "error" | "disconnected";
  external_account_id: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_by: string | null;
};

type EldConnectionSecretRow = {
  connection_id: string;
  tenant_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  api_key: string | null;
  created_at: string;
  updated_at: string;
};

type EldDriverLinkRow = TenantScopedRow & {
  provider: EldProvider;
  external_driver_id: string;
  driver_id: string;
};

type EldVehicleLinkRow = TenantScopedRow & {
  provider: EldProvider;
  external_vehicle_id: string;
  equipment_id: string;
};

type EldDriverProfileRow = TenantScopedRow & {
  provider: EldProvider;
  external_driver_id: string;
  driver_id: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  status: string | null;
  manager_name: string | null;
  manager_email: string | null;
  reported_at: string | null;
};

type EldDriverEventRow = TenantScopedRow & {
  provider: EldProvider;
  driver_id: string;
  equipment_id: string | null;
  event_type: "speeding" | "harsh_brake" | "harsh_accel" | "collision" | "other";
  external_event_id: string | null;
  occurred_at: string;
  severity: string | null;
  value: number | null;
  label: string | null;
  description: string | null;
  location: string | null;
  payload: Json;
};

type EldDriverPerformanceRow = TenantScopedRow & {
  provider: EldProvider;
  external_driver_id: string;
  driver_id: string;
  period_start: string | null;
  period_end: string | null;
  score: number | null;
  total_events: number | null;
  speeding_count: number | null;
  harsh_brake_count: number | null;
  harsh_accel_count: number | null;
  distance: number | null;
  drive_time_minutes: number | null;
  reported_at: string | null;
  payload: Json;
};

type EldDeviceRow = TenantScopedRow & {
  provider: EldProvider;
  external_vehicle_id: string;
  equipment_id: string;
  identifier: string | null;
  model: string | null;
  firmware: string | null;
  status: string | null;
  last_seen_at: string | null;
};

type EldVehicleEventRow = TenantScopedRow & {
  provider: EldProvider;
  equipment_id: string;
  event_type: "disconnect" | "fault_code";
  external_event_id: string | null;
  code: string | null;
  label: string | null;
  description: string | null;
  severity: string | null;
  occurred_at: string;
  payload: Json;
};

type TransportDocumentRow = TenantScopedRow & {
  registry_key: string;
  slot_key: string;
  scope: "company" | "driver" | "vehicle" | "incident" | "shipment";
  subject_id: string | null;
  title: string;
  storage_path: string | null;
  attachment_ids: string[];
  issued_date: string | null;
  expiry_date: string | null;
  status: "active" | "archived";
  notes: string | null;
  created_by: string | null;
  deleted_at: string | null;
};

type TransportMedicalRecordRow = TenantScopedRow & {
  driver_id: string;
  record_type: "injury" | "medical" | "wcb" | "first_aid" | "other";
  title: string;
  storage_path: string | null;
  occurred_on: string | null;
  notes: string | null;
  status: "active" | "archived";
  created_by: string | null;
  deleted_at: string | null;
};

/**
 * What sort of place a location is, for inventory purposes.
 *
 * The physical kinds are real places stock can sit. The two virtual kinds are what keep
 * the ledger honest: `transit` holds a load that has left but not arrived, and `loss`
 * absorbs damage, shrinkage, and count corrections. Virtual locations are the only ones
 * allowed to carry a negative balance.
 *
 * Not to be confused with `equipment.tracking_mode`, which is a different axis entirely.
 */
export type LocationKind =
  | "yard"
  | "customer_site"
  | "transit"
  | "loss"
  | "vendor"
  | "worker"
  | "vehicle"
  | "job";

export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          consultant_access_revoked: boolean;
          document_control_enabled: boolean;
          transport_enabled: boolean;
          cor_enabled: boolean;
          cor_certifying_partner: string;
          change_orders_enabled: boolean;
          daily_inspection_enabled: boolean;
          trades_enabled: boolean;
          gc_enabled: boolean;
          inventory_enabled: boolean;
          default_labor_rate: number;
          country: "CA" | "US";
          emr_rate: number | null;
          emr_year: number | null;
          safety_fitness_cert_number: string | null;
          safety_fitness_expires_on: string | null;
          subscription_status: "trial" | "active" | "past_due" | "cancelled" | "expired";
          plan: "core" | "operations" | "pro" | "carrier" | "standalone";
          standalone_modules: string[];
          trial_ends_at: string | null;
          current_period_end: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tenants"]["Row"]> & Pick<Database["public"]["Tables"]["tenants"]["Row"], "name" | "slug">;
        Update: Partial<Database["public"]["Tables"]["tenants"]["Row"]>;
        Relationships: [];
      };
      trade_customer: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          contact_name: string | null;
          email: string | null;
          phone: string | null;
          billing_address: string | null;
          notes: string | null;
          status: "active" | "archived";
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_customer"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_customer"]["Row"], "tenant_id" | "name">;
        Update: Partial<Database["public"]["Tables"]["trade_customer"]["Row"]>;
        Relationships: [];
      };
      trade_service_address: {
        Row: {
          id: string;
          tenant_id: string;
          customer_id: string;
          label: string | null;
          line1: string;
          line2: string | null;
          city: string | null;
          region: string | null;
          postal_code: string | null;
          is_primary: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_service_address"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_service_address"]["Row"], "tenant_id" | "customer_id" | "line1">;
        Update: Partial<Database["public"]["Tables"]["trade_service_address"]["Row"]>;
        Relationships: [];
      };
      trade_work_order: {
        Row: {
          id: string;
          tenant_id: string;
          customer_id: string;
          service_address_id: string | null;
          title: string;
          work_type: "service_call" | "project";
          status: "open" | "scheduled" | "in_progress" | "completed" | "cancelled";
          assigned_user_id: string | null;
          scheduled_start: string | null;
          scheduled_end: string | null;
          description: string | null;
          signed_off_name: string | null;
          signed_off_signature_path: string | null;
          signed_off_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_work_order"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_work_order"]["Row"], "tenant_id" | "customer_id" | "title">;
        Update: Partial<Database["public"]["Tables"]["trade_work_order"]["Row"]>;
        Relationships: [];
      };
      trade_price_book_item: {
        Row: {
          id: string;
          tenant_id: string;
          code: string | null;
          name: string;
          description: string | null;
          category: string | null;
          tier: "good" | "better" | "best" | "standard";
          unit: string | null;
          unit_price: number;
          active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_price_book_item"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_price_book_item"]["Row"], "tenant_id" | "name">;
        Update: Partial<Database["public"]["Tables"]["trade_price_book_item"]["Row"]>;
        Relationships: [];
      };
      trade_work_order_line: {
        Row: {
          id: string;
          tenant_id: string;
          work_order_id: string;
          price_book_item_id: string | null;
          name: string;
          quantity: number;
          unit_price: number;
          line_total: number;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_work_order_line"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_work_order_line"]["Row"], "tenant_id" | "work_order_id" | "name">;
        Update: Partial<Database["public"]["Tables"]["trade_work_order_line"]["Row"]>;
        Relationships: [];
      };
      trade_invoice: {
        Row: {
          id: string;
          tenant_id: string;
          customer_id: string;
          work_order_id: string | null;
          invoice_number: string;
          status: "draft" | "sent" | "paid" | "void";
          subtotal: number;
          tax_rate: number;
          tax_amount: number;
          total: number;
          issued_on: string | null;
          due_on: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_invoice"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_invoice"]["Row"], "tenant_id" | "customer_id" | "invoice_number">;
        Update: Partial<Database["public"]["Tables"]["trade_invoice"]["Row"]>;
        Relationships: [];
      };
      trade_invoice_line: {
        Row: {
          id: string;
          tenant_id: string;
          invoice_id: string;
          name: string;
          quantity: number;
          unit_price: number;
          line_total: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_invoice_line"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_invoice_line"]["Row"], "tenant_id" | "invoice_id" | "name">;
        Update: Partial<Database["public"]["Tables"]["trade_invoice_line"]["Row"]>;
        Relationships: [];
      };
      trade_service_agreement: {
        Row: {
          id: string;
          tenant_id: string;
          customer_id: string;
          service_address_id: string | null;
          name: string;
          billing_amount: number;
          billing_interval: "monthly" | "quarterly" | "annual";
          visits_per_year: number;
          status: "active" | "paused" | "cancelled";
          start_on: string | null;
          next_visit_on: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_service_agreement"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_service_agreement"]["Row"], "tenant_id" | "customer_id" | "name">;
        Update: Partial<Database["public"]["Tables"]["trade_service_agreement"]["Row"]>;
        Relationships: [];
      };
      trade_work_order_note: {
        Row: {
          id: string;
          tenant_id: string;
          work_order_id: string;
          author_user_id: string | null;
          note: string | null;
          photo_path: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_work_order_note"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_work_order_note"]["Row"], "tenant_id" | "work_order_id">;
        Update: Partial<Database["public"]["Tables"]["trade_work_order_note"]["Row"]>;
        Relationships: [];
      };
      trade_work_order_time: {
        Row: {
          id: string;
          tenant_id: string;
          work_order_id: string;
          user_id: string | null;
          started_at: string;
          ended_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_work_order_time"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_work_order_time"]["Row"], "tenant_id" | "work_order_id">;
        Update: Partial<Database["public"]["Tables"]["trade_work_order_time"]["Row"]>;
        Relationships: [];
      };
      trade_work_order_field_log: {
        Row: {
          id: string;
          tenant_id: string;
          work_order_id: string;
          user_id: string | null;
          entry_date: string;
          hours: number | null;
          travel_km: number | null;
          travel_minutes: number | null;
          note: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_work_order_field_log"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_work_order_field_log"]["Row"], "tenant_id" | "work_order_id">;
        Update: Partial<Database["public"]["Tables"]["trade_work_order_field_log"]["Row"]>;
        Relationships: [];
      };
      trade_work_order_material: {
        Row: {
          id: string;
          tenant_id: string;
          work_order_id: string;
          user_id: string | null;
          entry_date: string;
          name: string;
          quantity: number;
          unit: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_work_order_material"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_work_order_material"]["Row"], "tenant_id" | "work_order_id" | "name">;
        Update: Partial<Database["public"]["Tables"]["trade_work_order_material"]["Row"]>;
        Relationships: [];
      };
      trade_customer_equipment: {
        Row: {
          id: string;
          tenant_id: string;
          customer_id: string;
          service_address_id: string | null;
          work_order_id: string | null;
          equipment_type: string | null;
          make: string | null;
          model: string | null;
          serial: string | null;
          location_note: string | null;
          installed_on: string | null;
          notes: string | null;
          photo_path: string | null;
          condition: "good" | "monitor" | "needs_replacement" | null;
          needs_follow_up: boolean;
          follow_up_note: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_customer_equipment"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_customer_equipment"]["Row"], "tenant_id" | "customer_id">;
        Update: Partial<Database["public"]["Tables"]["trade_customer_equipment"]["Row"]>;
        Relationships: [];
      };
      trade_checklist_template: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          work_type: "service_call" | "project" | null;
          active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_checklist_template"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_checklist_template"]["Row"], "tenant_id" | "name">;
        Update: Partial<Database["public"]["Tables"]["trade_checklist_template"]["Row"]>;
        Relationships: [];
      };
      trade_checklist_template_item: {
        Row: {
          id: string;
          tenant_id: string;
          template_id: string;
          label: string;
          position: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_checklist_template_item"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_checklist_template_item"]["Row"], "tenant_id" | "template_id" | "label">;
        Update: Partial<Database["public"]["Tables"]["trade_checklist_template_item"]["Row"]>;
        Relationships: [];
      };
      trade_work_order_task: {
        Row: {
          id: string;
          tenant_id: string;
          work_order_id: string;
          source_template_id: string | null;
          label: string;
          position: number;
          done: boolean;
          done_by: string | null;
          done_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trade_work_order_task"]["Row"]> &
          Pick<Database["public"]["Tables"]["trade_work_order_task"]["Row"], "tenant_id" | "work_order_id" | "label">;
        Update: Partial<Database["public"]["Tables"]["trade_work_order_task"]["Row"]>;
        Relationships: [];
      };
      gc_rfi: {
        Row: {
          id: string;
          tenant_id: string;
          project_id: string;
          number: number;
          subject: string;
          question: string | null;
          status: "open" | "answered" | "closed";
          answer: string | null;
          due_on: string | null;
          created_by: string | null;
          answered_by: string | null;
          answered_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["gc_rfi"]["Row"]> &
          Pick<Database["public"]["Tables"]["gc_rfi"]["Row"], "tenant_id" | "project_id" | "number" | "subject">;
        Update: Partial<Database["public"]["Tables"]["gc_rfi"]["Row"]>;
        Relationships: [];
      };
      consultants: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["consultants"]["Row"]> & Pick<Database["public"]["Tables"]["consultants"]["Row"], "id" | "email" | "full_name">;
        Update: Partial<Database["public"]["Tables"]["consultants"]["Row"]>;
        Relationships: [];
      };
      consultant_access: {
        Row: {
          id: string;
          tenant_id: string;
          consultant_id: string | null;
          allowed: boolean;
          override_reason: string | null;
          override_condition: "court_order" | "ministry_order" | "ninety_day_dormancy" | null;
          override_expires_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["consultant_access"]["Row"]> & Pick<Database["public"]["Tables"]["consultant_access"]["Row"], "tenant_id">;
        Update: Partial<Database["public"]["Tables"]["consultant_access"]["Row"]>;
        Relationships: [];
      };
      consultant_audit_log: {
        Row: {
          id: string;
          tenant_id: string | null;
          consultant_id: string | null;
          action: string;
          metadata: Json;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["consultant_audit_log"]["Row"]> & Pick<Database["public"]["Tables"]["consultant_audit_log"]["Row"], "action">;
        Update: Partial<Database["public"]["Tables"]["consultant_audit_log"]["Row"]>;
        Relationships: [];
      };
      tenant_audit_log: {
        Row: {
          id: string;
          tenant_id: string;
          actor_user_id: string | null;
          actor_role: string | null;
          action: string;
          entity_table: string | null;
          entity_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tenant_audit_log"]["Row"]> &
          Pick<Database["public"]["Tables"]["tenant_audit_log"]["Row"], "tenant_id" | "action">;
        Update: Partial<Database["public"]["Tables"]["tenant_audit_log"]["Row"]>;
        Relationships: [];
      };
      users: {
        Row: TenantScopedRow & {
          email: string;
          full_name: string;
          power_level: Database["public"]["Enums"]["power_level"];
          reach_type: Database["public"]["Enums"]["reach_type"];
          permission_profile_id: string | null;
          app_access: Database["public"]["Enums"]["app_access_level"];
          offline_sync_days: number;
          active: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["users"]["Row"]> & Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "tenant_id" | "email" | "full_name" | "power_level">;
        Update: Partial<Database["public"]["Tables"]["users"]["Row"]>;
        Relationships: [];
      };
      permission_profiles: {
        Row: TenantScopedRow & {
          name: string;
          power_ceiling: Database["public"]["Enums"]["power_level"];
          capabilities: Json;
          is_default: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["permission_profiles"]["Row"]> & Pick<Database["public"]["Tables"]["permission_profiles"]["Row"], "tenant_id" | "name" | "power_ceiling">;
        Update: Partial<Database["public"]["Tables"]["permission_profiles"]["Row"]>;
        Relationships: [];
      };
      locations: {
        Row: TenantScopedRow & {
          name: string;
          code: string | null;
          visibility_rule: string;
          start_date: string | null;
          default_for_new_workers: boolean;
          location_kind: LocationKind;
        };
        Insert: Partial<Database["public"]["Tables"]["locations"]["Row"]> & Pick<Database["public"]["Tables"]["locations"]["Row"], "tenant_id" | "name">;
        Update: Partial<Database["public"]["Tables"]["locations"]["Row"]>;
        Relationships: [];
      };
      equipment: {
        Row: TenantScopedRow & {
          action_metadata: Json;
          assigned_to: string | null;
          category: "vehicle" | "mobile_equipment" | "trailer" | "generator" | "compressor" | "light_tower" | "tool" | "other";
          created_by: string | null;
          current_meter: number | null;
          deleted_at: string | null;
          is_commercial: boolean;
          license_plate: string | null;
          location_id: string | null;
          make: string | null;
          model: string | null;
          name: string | null;
          notes: string | null;
          photo_ids: string[];
          purchase_date: string | null;
          status: "active" | "down" | "retired" | "sold";
          tracking_mode: "mileage" | "hours";
          unit_number: string;
          vin_or_serial: string | null;
          year: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["equipment"]["Row"]> &
          Pick<Database["public"]["Tables"]["equipment"]["Row"], "tenant_id" | "unit_number" | "tracking_mode">;
        Update: Partial<Database["public"]["Tables"]["equipment"]["Row"]>;
        Relationships: [];
      };
      equipment_meter_log: {
        Row: TenantScopedRow & {
          action_metadata: Json;
          equipment_id: string;
          recorded_at: string;
          recorded_by: string | null;
          source: "manual" | "inspection" | "maintenance" | "eld";
          source_submission_id: string | null;
          value: number;
        };
        Insert: Partial<Database["public"]["Tables"]["equipment_meter_log"]["Row"]> &
          Pick<Database["public"]["Tables"]["equipment_meter_log"]["Row"], "tenant_id" | "equipment_id" | "value">;
        Update: Partial<Database["public"]["Tables"]["equipment_meter_log"]["Row"]>;
        Relationships: [];
      };
      dti_inspection: {
        Row: TenantScopedRow & {
          equipment_id: string;
          trailer_equipment_id: string | null;
          driver_user_id: string | null;
          province: "BC" | "AB" | "ON";
          schedule_no: number;
          inspection_type: "pre" | "post";
          odometer: number | null;
          location: string | null;
          overall_result: "clean" | "minor" | "major";
          out_of_service: boolean;
          out_of_service_cleared_at: string | null;
          out_of_service_cleared_by: string | null;
          signature_name: string | null;
          notes: string | null;
          source: "admin" | "worker" | "offline" | "import";
          completed_at: string;
          valid_until: string;
          created_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["dti_inspection"]["Row"]> &
          Pick<
            Database["public"]["Tables"]["dti_inspection"]["Row"],
            "tenant_id" | "equipment_id" | "province" | "overall_result" | "valid_until"
          >;
        Update: Partial<Database["public"]["Tables"]["dti_inspection"]["Row"]>;
        Relationships: [];
      };
      dti_inspection_item: {
        Row: {
          id: string;
          tenant_id: string;
          inspection_id: string;
          item_no: number;
          item_label: string;
          status: "pass" | "minor" | "major";
          note: string | null;
          photo_path: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["dti_inspection_item"]["Row"]> &
          Pick<
            Database["public"]["Tables"]["dti_inspection_item"]["Row"],
            "tenant_id" | "inspection_id" | "item_no" | "item_label" | "status"
          >;
        Update: Partial<Database["public"]["Tables"]["dti_inspection_item"]["Row"]>;
        Relationships: [];
      };
      equipment_maintenance_log: {
        Row: TenantScopedRow & {
          action_metadata: Json;
          attachment_ids: string[];
          cost: number | null;
          created_by: string | null;
          deleted_at: string | null;
          description: string | null;
          equipment_id: string;
          meter_at_service: number | null;
          performed_at: string;
          performed_by: string | null;
          title: string;
          type:
            | "oil_change"
            | "repair"
            | "inspection_service"
            | "tire"
            | "scheduled_service"
            | "unscheduled_repair"
            | "other";
          vendor: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["equipment_maintenance_log"]["Row"]> &
          Pick<Database["public"]["Tables"]["equipment_maintenance_log"]["Row"], "tenant_id" | "equipment_id" | "title">;
        Update: Partial<Database["public"]["Tables"]["equipment_maintenance_log"]["Row"]>;
        Relationships: [];
      };
      equipment_scheduled_service: {
        Row: TenantScopedRow & {
          action_metadata: Json;
          created_by: string | null;
          deleted_at: string | null;
          due_date: string | null;
          due_meter: number | null;
          window_start_meter: number | null;
          warn_meter: number | null;
          date_lead_days: number | null;
          meter_lead: number | null;
          equipment_id: string;
          interval_mode: "by_date" | "by_meter" | "both";
          is_active: boolean;
          last_completed_at: string | null;
          last_completed_meter: number | null;
          recurrence_unit: "meter" | "days" | "months" | null;
          recurrence_value: number | null;
          service_type: "oil_change" | "inspection" | "certification" | "registration" | "scheduled_maintenance" | "other";
          title: string;
        };
        Insert: Partial<Database["public"]["Tables"]["equipment_scheduled_service"]["Row"]> &
          Pick<
            Database["public"]["Tables"]["equipment_scheduled_service"]["Row"],
            "tenant_id" | "equipment_id" | "interval_mode" | "title"
          >;
        Update: Partial<Database["public"]["Tables"]["equipment_scheduled_service"]["Row"]>;
        Relationships: [];
      };
      equipment_submission_link: {
        Row: TenantScopedRow & {
          action_metadata: Json;
          created_by: string | null;
          equipment_id: string;
          form_type: string | null;
          linked_at: string;
          link_source: "auto" | "manual";
          submission_id: string;
        };
        Insert: Partial<Database["public"]["Tables"]["equipment_submission_link"]["Row"]> &
          Pick<
            Database["public"]["Tables"]["equipment_submission_link"]["Row"],
            "tenant_id" | "equipment_id" | "submission_id"
          >;
        Update: Partial<Database["public"]["Tables"]["equipment_submission_link"]["Row"]>;
        Relationships: [];
      };
      equipment_document: {
        Row: TenantScopedRow & {
          action_metadata: Json;
          attachment_ids: string[];
          created_by: string | null;
          deleted_at: string | null;
          doc_type: "registration" | "insurance" | "cvip" | "permit" | "certification" | "other";
          equipment_id: string;
          expiry_date: string;
          is_active: boolean;
          issued_date: string | null;
          reminder_lead_days: number;
          title: string;
        };
        Insert: Partial<Database["public"]["Tables"]["equipment_document"]["Row"]> &
          Pick<
            Database["public"]["Tables"]["equipment_document"]["Row"],
            "tenant_id" | "equipment_id" | "expiry_date" | "title"
          >;
        Update: Partial<Database["public"]["Tables"]["equipment_document"]["Row"]>;
        Relationships: [];
      };
      co_project: {
        Row: CoProjectRow;
        Insert: Partial<CoProjectRow> & Pick<CoProjectRow, "tenant_id" | "name">;
        Update: Partial<CoProjectRow>;
        Relationships: [];
      };
      change_order: {
        Row: ChangeOrderRow;
        Insert: Partial<ChangeOrderRow> &
          Pick<ChangeOrderRow, "tenant_id" | "project_id" | "number" | "title">;
        Update: Partial<ChangeOrderRow>;
        Relationships: [];
      };
      change_order_line: {
        Row: ChangeOrderLineRow;
        Insert: Partial<ChangeOrderLineRow> &
          Pick<ChangeOrderLineRow, "tenant_id" | "change_order_id" | "description">;
        Update: Partial<ChangeOrderLineRow>;
        Relationships: [];
      };
      change_order_markup: {
        Row: ChangeOrderMarkupRow;
        Insert: Partial<ChangeOrderMarkupRow> &
          Pick<ChangeOrderMarkupRow, "tenant_id" | "change_order_id" | "label">;
        Update: Partial<ChangeOrderMarkupRow>;
        Relationships: [];
      };
      change_order_approval: {
        Row: ChangeOrderApprovalRow;
        Insert: Partial<ChangeOrderApprovalRow> &
          Pick<ChangeOrderApprovalRow, "tenant_id" | "change_order_id" | "decision">;
        Update: Partial<ChangeOrderApprovalRow>;
        Relationships: [];
      };
      change_order_attachment: {
        Row: ChangeOrderAttachmentRow;
        Insert: Partial<ChangeOrderAttachmentRow> &
          Pick<ChangeOrderAttachmentRow, "tenant_id" | "change_order_id" | "file_name" | "storage_path">;
        Update: Partial<ChangeOrderAttachmentRow>;
        Relationships: [];
      };
      field_ticket: {
        Row: FieldTicketRow;
        Insert: Partial<FieldTicketRow> & Pick<FieldTicketRow, "tenant_id" | "title">;
        Update: Partial<FieldTicketRow>;
        Relationships: [];
      };
      transport_driver: {
        Row: TransportDriverRow;
        Insert: Partial<TransportDriverRow> & Pick<TransportDriverRow, "tenant_id" | "full_name">;
        Update: Partial<TransportDriverRow>;
        Relationships: [];
      };
      transport_document: {
        Row: TransportDocumentRow;
        Insert: Partial<TransportDocumentRow> &
          Pick<TransportDocumentRow, "tenant_id" | "registry_key" | "slot_key" | "scope" | "title">;
        Update: Partial<TransportDocumentRow>;
        Relationships: [];
      };
      transport_medical_record: {
        Row: TransportMedicalRecordRow;
        Insert: Partial<TransportMedicalRecordRow> &
          Pick<TransportMedicalRecordRow, "tenant_id" | "driver_id" | "title">;
        Update: Partial<TransportMedicalRecordRow>;
        Relationships: [];
      };
      transport_duty_status_event: {
        Row: TransportDutyStatusEventRow;
        Insert: Partial<TransportDutyStatusEventRow> &
          Pick<TransportDutyStatusEventRow, "tenant_id" | "driver_id" | "status" | "started_at">;
        Update: Partial<TransportDutyStatusEventRow>;
        Relationships: [];
      };
      eld_connection: {
        Row: EldConnectionRow;
        Insert: Partial<EldConnectionRow> & Pick<EldConnectionRow, "tenant_id" | "provider">;
        Update: Partial<EldConnectionRow>;
        Relationships: [];
      };
      eld_connection_secret: {
        Row: EldConnectionSecretRow;
        Insert: Partial<EldConnectionSecretRow> & Pick<EldConnectionSecretRow, "connection_id" | "tenant_id">;
        Update: Partial<EldConnectionSecretRow>;
        Relationships: [];
      };
      eld_driver_link: {
        Row: EldDriverLinkRow;
        Insert: Partial<EldDriverLinkRow> &
          Pick<EldDriverLinkRow, "tenant_id" | "provider" | "external_driver_id" | "driver_id">;
        Update: Partial<EldDriverLinkRow>;
        Relationships: [];
      };
      eld_driver_profile: {
        Row: EldDriverProfileRow;
        Insert: Partial<EldDriverProfileRow> &
          Pick<EldDriverProfileRow, "tenant_id" | "provider" | "external_driver_id" | "driver_id">;
        Update: Partial<EldDriverProfileRow>;
        Relationships: [];
      };
      eld_driver_event: {
        Row: EldDriverEventRow;
        Insert: Partial<EldDriverEventRow> &
          Pick<EldDriverEventRow, "tenant_id" | "provider" | "driver_id" | "event_type" | "occurred_at">;
        Update: Partial<EldDriverEventRow>;
        Relationships: [];
      };
      eld_driver_performance: {
        Row: EldDriverPerformanceRow;
        Insert: Partial<EldDriverPerformanceRow> &
          Pick<EldDriverPerformanceRow, "tenant_id" | "provider" | "external_driver_id" | "driver_id">;
        Update: Partial<EldDriverPerformanceRow>;
        Relationships: [];
      };
      eld_vehicle_link: {
        Row: EldVehicleLinkRow;
        Insert: Partial<EldVehicleLinkRow> &
          Pick<EldVehicleLinkRow, "tenant_id" | "provider" | "external_vehicle_id" | "equipment_id">;
        Update: Partial<EldVehicleLinkRow>;
        Relationships: [];
      };
      eld_device: {
        Row: EldDeviceRow;
        Insert: Partial<EldDeviceRow> &
          Pick<EldDeviceRow, "tenant_id" | "provider" | "external_vehicle_id" | "equipment_id">;
        Update: Partial<EldDeviceRow>;
        Relationships: [];
      };
      eld_vehicle_event: {
        Row: EldVehicleEventRow;
        Insert: Partial<EldVehicleEventRow> &
          Pick<EldVehicleEventRow, "tenant_id" | "provider" | "equipment_id" | "event_type" | "occurred_at">;
        Update: Partial<EldVehicleEventRow>;
        Relationships: [];
      };
      user_locations: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          location_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["user_locations"]["Row"]> &
          Pick<Database["public"]["Tables"]["user_locations"]["Row"], "tenant_id" | "user_id" | "location_id">;
        Update: Partial<Database["public"]["Tables"]["user_locations"]["Row"]>;
        Relationships: [];
      };
      visitors: {
        Row: TenantScopedRow & {
          location_id: string;
          full_name: string;
          organization: string | null;
          visit_reason: string;
          signed_in_at: string;
          signed_out_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["visitors"]["Row"]> &
          Pick<
            Database["public"]["Tables"]["visitors"]["Row"],
            "tenant_id" | "location_id" | "full_name" | "visit_reason"
          >;
        Update: Partial<Database["public"]["Tables"]["visitors"]["Row"]>;
        Relationships: [];
      };
      worker_time_cards: {
        Row: TenantScopedRow & {
          clocked_in_at: string;
          clocked_out_at: string | null;
          location_id: string;
          note: string | null;
          worker_user_id: string;
        };
        Insert: Partial<Database["public"]["Tables"]["worker_time_cards"]["Row"]> &
          Pick<
            Database["public"]["Tables"]["worker_time_cards"]["Row"],
            "tenant_id" | "worker_user_id" | "location_id"
          >;
        Update: Partial<Database["public"]["Tables"]["worker_time_cards"]["Row"]>;
        Relationships: [];
      };
      worker_profiles: {
        Row: TenantScopedRow & {
          user_id: string;
          photo_path: string | null;
          title: string | null;
          phone: string | null;
          employee_number: string | null;
          hired_on: string | null;
          emergency_contacts: Json;
        };
        Insert: Partial<Database["public"]["Tables"]["worker_profiles"]["Row"]> &
          Pick<Database["public"]["Tables"]["worker_profiles"]["Row"], "tenant_id" | "user_id">;
        Update: Partial<Database["public"]["Tables"]["worker_profiles"]["Row"]>;
        Relationships: [];
      };
      certification_types: {
        Row: TenantScopedRow & {
          name: string;
          expires: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["certification_types"]["Row"]> &
          Pick<Database["public"]["Tables"]["certification_types"]["Row"], "tenant_id" | "name">;
        Update: Partial<Database["public"]["Tables"]["certification_types"]["Row"]>;
        Relationships: [];
      };
      certifications: {
        Row: TenantScopedRow & {
          worker_profile_id: string;
          certification_type_id: string | null;
          name: string;
          issued_on: string | null;
          expires_on: string | null;
          attachment_path: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["certifications"]["Row"]> &
          Pick<Database["public"]["Tables"]["certifications"]["Row"], "tenant_id" | "worker_profile_id" | "name">;
        Update: Partial<Database["public"]["Tables"]["certifications"]["Row"]>;
        Relationships: [];
      };
      lists: {
        Row: TenantScopedRow & {
          name: string;
          include_other: boolean;
          used_in_forms_count: number;
          created_by: string | null;
        };
        Insert: Partial<TenantScopedRow & { created_by: string | null; include_other: boolean; name: string; used_in_forms_count: number }> & {
          name: string;
          tenant_id: string;
        };
        Update: Partial<TenantScopedRow & { created_by: string | null; include_other: boolean; name: string; used_in_forms_count: number }>;
        Relationships: [];
      };
      list_items: {
        Row: TenantScopedRow & {
          list_id: string;
          parent_id: string | null;
          label: string;
          sort_order: number;
          active: boolean;
        };
        Insert: Partial<TenantScopedRow & { active: boolean; label: string; list_id: string; parent_id: string | null; sort_order: number }> & {
          label: string;
          list_id: string;
          tenant_id: string;
        };
        Update: Partial<TenantScopedRow & { active: boolean; label: string; list_id: string; parent_id: string | null; sort_order: number }>;
        Relationships: [];
      };
      forms: {
        Row: TenantScopedRow & {
          name: string;
          code: string;
          description: string | null;
          status: string;
          is_private: boolean;
          app_menu_visible: boolean;
          allow_duplicates: boolean;
          use_item_data_in_analytics: boolean;
          import_detected_text: string | null;
          import_detected_fields: Json;
          created_by: string | null;
          cor_element: number | null;
          cor_element_key: string | null;
          cor_tracked: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["forms"]["Row"]> & Pick<Database["public"]["Tables"]["forms"]["Row"], "tenant_id" | "name" | "code">;
        Update: Partial<Database["public"]["Tables"]["forms"]["Row"]>;
        Relationships: [];
      };
      form_sections: {
        Row: TenantScopedRow & {
          form_id: string;
          title: string;
          sort_order: number;
          collapsible: boolean;
          repeatable: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["form_sections"]["Row"]> &
          Pick<Database["public"]["Tables"]["form_sections"]["Row"], "tenant_id" | "form_id" | "title">;
        Update: Partial<Database["public"]["Tables"]["form_sections"]["Row"]>;
        Relationships: [];
      };
      form_items: {
        Row: TenantScopedRow & {
          form_id: string;
          section_id: string;
          field_type: string;
          label: string;
          helper_text: string | null;
          required: boolean;
          flaggable: boolean;
          settings: Json;
          sort_order: number;
        };
        Insert: Partial<Database["public"]["Tables"]["form_items"]["Row"]> &
          Pick<
            Database["public"]["Tables"]["form_items"]["Row"],
            "tenant_id" | "form_id" | "section_id" | "field_type" | "label"
          >;
        Update: Partial<Database["public"]["Tables"]["form_items"]["Row"]>;
        Relationships: [];
      };
      resources: {
        Row: TenantScopedRow & {
          section_id: string | null;
          name: string;
          storage_path: string;
          mime_type: string | null;
          dcn: string | null;
          search_text: string | null;
          body_text: string | null;
          version: string;
          sort_order: number;
          uploaded_by: string | null;
          cor_element: number | null;
          cor_element_key: string | null;
          cor_tracked: boolean;
          review_date: string | null;
          review_interval_months: number | null;
          reminder_lead_days: number;
        };
        Insert: Partial<Database["public"]["Tables"]["resources"]["Row"]> &
          Pick<Database["public"]["Tables"]["resources"]["Row"], "tenant_id" | "name" | "storage_path">;
        Update: Partial<Database["public"]["Tables"]["resources"]["Row"]>;
        Relationships: [];
      };
      resource_sections: {
        Row: TenantScopedRow & {
          name: string;
          sort_order: number;
        };
        Insert: Partial<Database["public"]["Tables"]["resource_sections"]["Row"]> &
          Pick<Database["public"]["Tables"]["resource_sections"]["Row"], "tenant_id" | "name">;
        Update: Partial<Database["public"]["Tables"]["resource_sections"]["Row"]>;
        Relationships: [];
      };
      document_control_register: {
        Row: TenantScopedRow & {
          document_type: string;
          source_table: string;
          source_id: string;
          dcn: string;
          version: string;
          revision_notes: string | null;
          active: boolean;
          approval_status: string;
          approved_by: string | null;
          approved_at: string | null;
          revision_of_id: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["document_control_register"]["Row"]> &
          Pick<
            Database["public"]["Tables"]["document_control_register"]["Row"],
            "tenant_id" | "document_type" | "source_table" | "source_id" | "dcn"
          >;
        Update: Partial<Database["public"]["Tables"]["document_control_register"]["Row"]>;
        Relationships: [];
      };
      submissions: {
        Row: TenantScopedRow & {
          form_id: string;
          location_id: string | null;
          submitted_by: string | null;
          status: string;
          source_device_id: string | null;
          signed_device_id: string | null;
          sync_state: string;
          submitted_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["submissions"]["Row"]> & Pick<Database["public"]["Tables"]["submissions"]["Row"], "tenant_id" | "form_id">;
        Update: Partial<Database["public"]["Tables"]["submissions"]["Row"]>;
        Relationships: [];
      };
      submission_values: {
        Row: TenantScopedRow & {
          submission_id: string;
          form_item_id: string;
          value: Json;
        };
        Insert: Partial<Database["public"]["Tables"]["submission_values"]["Row"]> &
          Pick<
            Database["public"]["Tables"]["submission_values"]["Row"],
            "tenant_id" | "submission_id" | "form_item_id" | "value"
          >;
        Update: Partial<Database["public"]["Tables"]["submission_values"]["Row"]>;
        Relationships: [];
      };
      signatures: {
        Row: {
          id: string;
          tenant_id: string;
          submission_id: string;
          signer_user_id: string | null;
          signer_name: string;
          signature_path: string;
          signed_at: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["signatures"]["Row"]> &
          Pick<
            Database["public"]["Tables"]["signatures"]["Row"],
            "tenant_id" | "submission_id" | "signer_name" | "signature_path"
          >;
        Update: Partial<Database["public"]["Tables"]["signatures"]["Row"]>;
        Relationships: [];
      };
      submission_photos: {
        Row: TenantScopedRow & {
          submission_id: string;
          form_item_id: string | null;
          storage_path: string | null;
          local_dexie_id: string | null;
          caption: string | null;
          captured_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["submission_photos"]["Row"]> &
          Pick<Database["public"]["Tables"]["submission_photos"]["Row"], "tenant_id" | "submission_id">;
        Update: Partial<Database["public"]["Tables"]["submission_photos"]["Row"]>;
        Relationships: [];
      };
      follow_ups: {
        Row: TenantScopedRow & {
          parent_submission_id: string | null;
          form_item_id: string | null;
          assigned_to: string | null;
          title: string;
          description: string | null;
          status: string;
          due_at: string | null;
          completed_at: string | null;
          photo_path: string | null;
          signoff_by: string | null;
          signoff_at: string | null;
          equipment_id: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["follow_ups"]["Row"]> &
          Pick<Database["public"]["Tables"]["follow_ups"]["Row"], "tenant_id" | "title">;
        Update: Partial<Database["public"]["Tables"]["follow_ups"]["Row"]>;
        Relationships: [];
      };
      workflows: {
        Row: TenantScopedRow & {
          name: string;
          enabled: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["workflows"]["Row"]> &
          Pick<Database["public"]["Tables"]["workflows"]["Row"], "tenant_id" | "name">;
        Update: Partial<Database["public"]["Tables"]["workflows"]["Row"]>;
        Relationships: [];
      };
      workflow_steps: {
        Row: TenantScopedRow & {
          workflow_id: string;
          form_id: string | null;
          assignee_type: string;
          assignee_user_id: string | null;
          sort_order: number;
        };
        Insert: Partial<Database["public"]["Tables"]["workflow_steps"]["Row"]> &
          Pick<Database["public"]["Tables"]["workflow_steps"]["Row"], "tenant_id" | "workflow_id">;
        Update: Partial<Database["public"]["Tables"]["workflow_steps"]["Row"]>;
        Relationships: [];
      };
      workflow_conditions: {
        Row: TenantScopedRow & {
          workflow_step_id: string;
          source_form_id: string | null;
          source_item_id: string | null;
          comparator: string;
          expected_value: Json;
          next_step_id: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["workflow_conditions"]["Row"]> &
          Pick<Database["public"]["Tables"]["workflow_conditions"]["Row"], "tenant_id" | "workflow_step_id" | "comparator">;
        Update: Partial<Database["public"]["Tables"]["workflow_conditions"]["Row"]>;
        Relationships: [];
      };
      workflow_runs: {
        Row: {
          id: string;
          tenant_id: string;
          workflow_id: string;
          location_id: string | null;
          status: string;
          started_by: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["workflow_runs"]["Row"]> &
          Pick<Database["public"]["Tables"]["workflow_runs"]["Row"], "tenant_id" | "workflow_id">;
        Update: Partial<Database["public"]["Tables"]["workflow_runs"]["Row"]>;
        Relationships: [];
      };
      workflow_run_steps: {
        Row: TenantScopedRow & {
          workflow_run_id: string;
          workflow_step_id: string;
          assigned_to: string | null;
          submission_id: string | null;
          status: string;
          due_at: string | null;
          completed_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["workflow_run_steps"]["Row"]> &
          Pick<
            Database["public"]["Tables"]["workflow_run_steps"]["Row"],
            "tenant_id" | "workflow_run_id" | "workflow_step_id"
          >;
        Update: Partial<Database["public"]["Tables"]["workflow_run_steps"]["Row"]>;
        Relationships: [];
      };
      schedules: {
        Row: TenantScopedRow & {
          name: string;
          form_id: string | null;
          location_id: string | null;
          assignee_id: string | null;
          recurrence_rule: string;
          next_due_at: string | null;
          active: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["schedules"]["Row"]> &
          Pick<Database["public"]["Tables"]["schedules"]["Row"], "tenant_id" | "name" | "recurrence_rule">;
        Update: Partial<Database["public"]["Tables"]["schedules"]["Row"]>;
        Relationships: [];
      };
      scheduled_tasks: {
        Row: TenantScopedRow & {
          schedule_id: string;
          assigned_to: string | null;
          due_at: string;
          completed_submission_id: string | null;
          status: string;
        };
        Insert: Partial<Database["public"]["Tables"]["scheduled_tasks"]["Row"]> & Pick<Database["public"]["Tables"]["scheduled_tasks"]["Row"], "tenant_id" | "schedule_id" | "due_at">;
        Update: Partial<Database["public"]["Tables"]["scheduled_tasks"]["Row"]>;
        Relationships: [];
      };
      auto_share_recipients: {
        Row: TenantScopedRow & {
          location_id: string | null;
          name: string;
          recipient_type: string;
          email: string | null;
          phone: string | null;
          active: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["auto_share_recipients"]["Row"]> &
          Pick<Database["public"]["Tables"]["auto_share_recipients"]["Row"], "tenant_id" | "name" | "recipient_type">;
        Update: Partial<Database["public"]["Tables"]["auto_share_recipients"]["Row"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string | null;
          submission_id: string | null;
          title: string;
          body: string;
          channel: string;
          recipient_name: string | null;
          recipient_contact: string | null;
          recipient_type: string | null;
          delivery_attempts: number;
          delivery_status: string;
          delivery_error: string | null;
          delivered_at: string | null;
          failed_at: string | null;
          last_delivery_attempt_at: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["notifications"]["Row"]> &
          Pick<Database["public"]["Tables"]["notifications"]["Row"], "tenant_id" | "title" | "body">;
        Update: Partial<Database["public"]["Tables"]["notifications"]["Row"]>;
        Relationships: [];
      };
      company_settings: {
        Row: TenantScopedRow & {
          company_name: string;
          address: string | null;
          phone: string | null;
          timezone: string;
          logo_path: string | null;
          company_id: string | null;
          dcn_company_prefix: string | null;
          dcn_include_revision: boolean;
          dcn_include_source_code: boolean;
          dcn_include_year: boolean;
          dcn_sequence_padding: number;
          integrations: Json;
          maintenance_contact_user_id: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["company_settings"]["Row"]> &
          Pick<Database["public"]["Tables"]["company_settings"]["Row"], "tenant_id" | "company_name">;
        Update: Partial<Database["public"]["Tables"]["company_settings"]["Row"]>;
        Relationships: [];
      };
      print_settings: {
        Row: TenantScopedRow & {
          footer_note: string;
          header_option: "company_info_only" | "company_info_and_logo" | "logo_only";
          logo_placement: "left" | "right";
          prepared_by_label: string;
          show_printed_at: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["print_settings"]["Row"]> &
          Pick<Database["public"]["Tables"]["print_settings"]["Row"], "tenant_id">;
        Update: Partial<Database["public"]["Tables"]["print_settings"]["Row"]>;
        Relationships: [];
      };
    } & {
      [Table in Exclude<
        TenantScopedTable,
        | "users"
        | "permission_profiles"
        | "locations"
        | "equipment"
        | "equipment_meter_log"
        | "equipment_maintenance_log"
        | "equipment_scheduled_service"
        | "equipment_submission_link"
        | "equipment_document"
        | "user_locations"
        | "visitors"
        | "worker_time_cards"
        | "worker_profiles"
        | "certification_types"
        | "certifications"
        | "forms"
        | "form_sections"
        | "form_items"
        | "resource_sections"
        | "resources"
        | "document_control_register"
        | "submissions"
        | "submission_values"
        | "signatures"
        | "submission_photos"
        | "follow_ups"
        | "workflows"
        | "workflow_steps"
        | "workflow_conditions"
        | "workflow_runs"
        | "workflow_run_steps"
        | "schedules"
        | "scheduled_tasks"
        | "auto_share_recipients"
        | "notifications"
        | "company_settings"
        | "print_settings"
      >]: {
        Row: TenantScopedRow & Record<string, Json | undefined>;
        Insert: Partial<TenantScopedRow> & { tenant_id: string } & Record<string, Json | undefined>;
        Update: Partial<TenantScopedRow> & Record<string, Json | undefined>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      app_access_level: "no_access" | "app_access" | "admin_access" | "super_admin_access";
      power_level: "consultant" | "super_admin" | "admin" | "manager" | "supervisor" | "worker";
      reach_type: "all_locations" | "specific_locations";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
