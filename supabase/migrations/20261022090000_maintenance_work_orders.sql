-- Maintenance module: the work order.
--
-- An internal job on one of the tenant's own assets (or on a place, when there is no
-- asset). It is a separate object from the trades module's customer work orders on
-- purpose: it has no customer, never feeds an invoice, and carries the asset's history
-- instead. The status rules live in src/lib/maintenance.ts and, for anything a person
-- could otherwise skip, in transition_maintenance_work_order; the table holds the shape
-- and the invariants that must hold whoever writes the row.
--
-- Where a work order came from is recorded as source and source_id:
--   manual             raised by a person; no source id
--   follow_up          a corrective action; source_id is the follow-up
--   scheduled_service  a scheduled service that came due; source_id is the service
--   inspection         a failed inspection item; source_id is the form item, so one open
--                      work order per item and asset
--   service_request    reserved for the public service request page (a later slice)
-- The typed links beside it (follow_up_id, scheduled_service_id, submission_id,
-- form_item_id) carry foreign keys so the screens can link straight to the record.

create table if not exists "public"."maintenance_work_order" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,

  -- Assigned per tenant by trigger, shown as WO-000123.
  "number" integer not null,
  "title" text not null,
  "description" text,

  -- The asset the work is on. Null for work on a place with no asset record.
  "equipment_id" uuid,
  "location_id" uuid,

  "type" text default 'corrective'::text not null,
  "priority" text default 'normal'::text not null,
  "status" text default 'requested'::text not null,

  "source" text default 'manual'::text not null,
  "source_id" uuid,
  "follow_up_id" uuid,
  "scheduled_service_id" uuid,
  "submission_id" uuid,
  "form_item_id" uuid,

  "requester_id" uuid,
  "assignee_id" uuid,
  "scheduled_start" date,
  "due_date" date,

  -- Completion: notes always, a meter reading when the asset is metered.
  "meter_at_completion" numeric,
  "completion_notes" text,

  -- One timestamp per status change, so a report can ask "completed in March" without
  -- reading the trail.
  "approved_at" timestamp with time zone,
  "assigned_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "completed_by" uuid,
  "closed_at" timestamp with time zone,
  "closed_by" uuid,
  "cancelled_at" timestamp with time zone,

  -- The asset history rows closing wrote, so a reopen and a second close update them
  -- instead of writing the job into the history twice.
  "maintenance_log_id" uuid,
  "meter_log_id" uuid,

  -- The cost roll-up, kept by trigger from the labour, parts and cost rows. Never typed in.
  "labour_cost" numeric(14,2) default 0 not null,
  "parts_cost" numeric(14,2) default 0 not null,
  "vendor_cost" numeric(14,2) default 0 not null,
  "other_cost" numeric(14,2) default 0 not null,
  "total_cost" numeric(14,2) default 0 not null,

  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "maintenance_work_order_status_check" check (
    "status" = any (array[
      'requested'::text,
      'approved'::text,
      'assigned'::text,
      'in_progress'::text,
      'on_hold'::text,
      'completed'::text,
      'closed'::text,
      'cancelled'::text
    ])
  ),

  constraint "maintenance_work_order_type_check" check (
    "type" = any (array['corrective'::text, 'preventive'::text, 'inspection'::text, 'project'::text])
  ),

  constraint "maintenance_work_order_priority_check" check (
    "priority" = any (array['urgent'::text, 'high'::text, 'normal'::text, 'low'::text])
  ),

  constraint "maintenance_work_order_source_check" check (
    "source" = any (array[
      'manual'::text,
      'follow_up'::text,
      'scheduled_service'::text,
      'service_request'::text,
      'inspection'::text
    ])
  ),

  -- A manual work order has no source record; every other source names one.
  constraint "maintenance_work_order_source_id_check" check (("source" = 'manual'::text) = ("source_id" is null)),

  -- Completed and closed work orders say what was done.
  constraint "maintenance_work_order_completion_check" check (
    "status" not in ('completed', 'closed')
    or ("completed_at" is not null and nullif(btrim(coalesce("completion_notes", '')), '') is not null)
  ),

  constraint "maintenance_work_order_meter_check" check ("meter_at_completion" is null or "meter_at_completion" >= 0),

  constraint "maintenance_work_order_costs_check" check (
    "labour_cost" >= 0 and "parts_cost" >= 0 and "vendor_cost" >= 0 and "other_cost" >= 0 and "total_cost" >= 0
  ),

  -- The total is arithmetic, not an opinion.
  constraint "maintenance_work_order_total_check" check (
    "total_cost" = "labour_cost" + "parts_cost" + "vendor_cost" + "other_cost"
  ),

  constraint "maintenance_work_order_number_check" check ("number" > 0)
);

alter table "public"."maintenance_work_order" owner to "postgres";

comment on table "public"."maintenance_work_order" is
  'An internal maintenance work order on one of the company''s own assets: requested, approved, assigned, in progress, on hold, completed, closed or cancelled. No customer, no invoice.';

comment on column "public"."maintenance_work_order"."source_id" is
  'The record the work order came from: the follow-up, the scheduled service, or for an inspection the failed form item (one open work order per item and asset).';

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_pkey" primary key ("id");

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_equipment_id_fkey" foreign key ("equipment_id") references "public"."equipment"("id") on delete set null;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_location_id_fkey" foreign key ("location_id") references "public"."locations"("id") on delete set null;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_follow_up_id_fkey" foreign key ("follow_up_id") references "public"."follow_ups"("id") on delete set null;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_scheduled_service_id_fkey" foreign key ("scheduled_service_id") references "public"."equipment_scheduled_service"("id") on delete set null;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_submission_id_fkey" foreign key ("submission_id") references "public"."submissions"("id") on delete set null;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_form_item_id_fkey" foreign key ("form_item_id") references "public"."form_items"("id") on delete set null;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_requester_id_fkey" foreign key ("requester_id") references "public"."users"("id") on delete set null;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_assignee_id_fkey" foreign key ("assignee_id") references "public"."users"("id") on delete set null;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_completed_by_fkey" foreign key ("completed_by") references "public"."users"("id") on delete set null;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_closed_by_fkey" foreign key ("closed_by") references "public"."users"("id") on delete set null;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_maintenance_log_id_fkey" foreign key ("maintenance_log_id") references "public"."equipment_maintenance_log"("id") on delete set null;

alter table only "public"."maintenance_work_order"
  add constraint "maintenance_work_order_meter_log_id_fkey" foreign key ("meter_log_id") references "public"."equipment_meter_log"("id") on delete set null;

create unique index if not exists "maintenance_work_order_tenant_number_key"
  on "public"."maintenance_work_order" ("tenant_id", "number");

-- Never two open work orders for the same asset and source. The functions that raise work
-- orders from a source look for an open one first and reuse it; this index is what makes
-- that hold even when two of them run at the same moment.
create unique index if not exists "maintenance_work_order_open_source_key"
  on "public"."maintenance_work_order" (
    "tenant_id",
    "source",
    "source_id",
    coalesce("equipment_id", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where "source" <> 'manual'
    and "status" in ('requested', 'approved', 'assigned', 'in_progress', 'on_hold');

create index if not exists "maintenance_work_order_tenant_status_idx"
  on "public"."maintenance_work_order" ("tenant_id", "status", "created_at" desc);

create index if not exists "maintenance_work_order_tenant_equipment_idx"
  on "public"."maintenance_work_order" ("tenant_id", "equipment_id");

create index if not exists "maintenance_work_order_tenant_assignee_idx"
  on "public"."maintenance_work_order" ("tenant_id", "assignee_id", "status");

-- The next work order number for a tenant. Same technique as purchase orders: an advisory
-- lock keyed to the tenant serializes two inserts at once, held for the transaction only.
create or replace function "public"."assign_maintenance_work_order_number"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
begin
  if new.number is null then
    perform pg_advisory_xact_lock(hashtextextended('maintenance_work_order_number:' || new.tenant_id::text, 0));

    select coalesce(max(wo.number), 0) + 1
      into new.number
      from public.maintenance_work_order wo
     where wo.tenant_id = new.tenant_id;
  end if;

  return new;
end;
$$;

alter function "public"."assign_maintenance_work_order_number"() owner to "postgres";

-- A trigger function has no business on the public API. Revoking EXECUTE does not stop
-- the trigger, which runs whoever holds the privilege.
revoke execute on function "public"."assign_maintenance_work_order_number"() from "public", "anon", "authenticated";

create or replace trigger "maintenance_work_order_assign_number"
  before insert on "public"."maintenance_work_order"
  for each row execute function "public"."assign_maintenance_work_order_number"();

create or replace trigger "maintenance_work_order_set_updated_at"
  before update on "public"."maintenance_work_order"
  for each row execute function "public"."set_updated_at"();

alter table "public"."maintenance_work_order" enable row level security;

create policy "maintenance_work_order_tenant_select" on "public"."maintenance_work_order"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "maintenance_work_order_tenant_insert" on "public"."maintenance_work_order"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "maintenance_work_order_tenant_update" on "public"."maintenance_work_order"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "maintenance_work_order_tenant_delete" on "public"."maintenance_work_order"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

grant select, insert, update, delete on table "public"."maintenance_work_order" to "authenticated";
grant select, insert, update, delete on table "public"."maintenance_work_order" to "service_role";
