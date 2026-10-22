-- Purchasing module: approval rules, the tenant's approval settings, and the trail.
--
-- The order total picks the rule. How a rule is matched (band or sequential, the
-- requester never approving their own order, the auto-approve limit) is decided in
-- src/lib/purchasing.ts, where it is unit tested. The database stores the rules and
-- records every decision in an append-only trail.

create table if not exists "public"."purchase_approval_rule" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "name" text not null,

  -- An order at or above this total is caught by the rule.
  "threshold" numeric(14,2) default 0 not null,
  "approver_user_ids" uuid[] default '{}'::uuid[] not null,

  -- band: the highest band at or under the total decides, and one approver from it (or
  -- from any higher band) is enough.
  -- sequential: every level up to the matching one approves, in order.
  "style" text default 'band'::text not null,
  "level" integer default 1 not null,
  "active" boolean default true not null,

  -- Null applies everywhere. A rule for a location replaces the company-wide rules for
  -- orders at that location.
  "location_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "purchase_approval_rule_style_check" check ("style" = any (array['band'::text, 'sequential'::text])),
  constraint "purchase_approval_rule_threshold_check" check ("threshold" >= 0),
  constraint "purchase_approval_rule_level_check" check ("level" >= 1)
);

alter table "public"."purchase_approval_rule" owner to "postgres";

comment on table "public"."purchase_approval_rule" is
  'Who approves a purchase order, chosen by its total. Band style: one approver from the matching band or above. Sequential style: every level up to the matching one, in order.';

-- One row per tenant. Kept out of public.tenants because a tenant row can only be
-- updated by a super admin, and these are purchasing decisions an admin makes.
create table if not exists "public"."purchase_settings" (
  "tenant_id" uuid not null,

  -- Below the lowest threshold an order approves itself when this is on. Off by default:
  -- nothing is bought without a person saying yes until the tenant decides otherwise.
  "auto_approve_below_lowest" boolean default false not null,
  "require_reject_reason" boolean default true not null,
  "updated_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null
);

alter table "public"."purchase_settings" owner to "postgres";

comment on table "public"."purchase_settings" is
  'Per-tenant purchasing choices: whether small orders approve themselves, and whether a rejection needs a reason.';

create table if not exists "public"."purchase_order_event" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "purchase_order_id" uuid not null,
  "action" text not null,
  "actor_user_id" uuid,

  -- The name at the time, so the trail still reads correctly after someone leaves.
  "actor_name" text,
  "rule_id" uuid,
  "level" integer,
  "reason" text,
  "emergency" boolean default false not null,
  "created_at" timestamp with time zone default "now"() not null,

  constraint "purchase_order_event_action_check" check (
    "action" = any (array[
      'created'::text,
      'submitted'::text,
      'withdrawn'::text,
      'approved'::text,
      'rejected'::text,
      'ordered'::text,
      'order_undone'::text,
      'received'::text,
      'closed'::text,
      'cancelled'::text,
      'reopened'::text,
      'exported'::text
    ])
  )
);

alter table "public"."purchase_order_event" owner to "postgres";

comment on table "public"."purchase_order_event" is
  'The audit and approval trail of a purchase order. Append-only: nobody edits what happened, they add what happened next.';

alter table only "public"."purchase_approval_rule"
  add constraint "purchase_approval_rule_pkey" primary key ("id");

alter table only "public"."purchase_settings"
  add constraint "purchase_settings_pkey" primary key ("tenant_id");

alter table only "public"."purchase_order_event"
  add constraint "purchase_order_event_pkey" primary key ("id");

alter table only "public"."purchase_approval_rule"
  add constraint "purchase_approval_rule_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."purchase_approval_rule"
  add constraint "purchase_approval_rule_location_id_fkey" foreign key ("location_id") references "public"."locations"("id") on delete cascade;

alter table only "public"."purchase_approval_rule"
  add constraint "purchase_approval_rule_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."purchase_settings"
  add constraint "purchase_settings_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."purchase_settings"
  add constraint "purchase_settings_updated_by_fkey" foreign key ("updated_by") references "public"."users"("id") on delete set null;

alter table only "public"."purchase_order_event"
  add constraint "purchase_order_event_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."purchase_order_event"
  add constraint "purchase_order_event_purchase_order_id_fkey" foreign key ("purchase_order_id") references "public"."purchase_order"("id") on delete cascade;

alter table only "public"."purchase_order_event"
  add constraint "purchase_order_event_actor_user_id_fkey" foreign key ("actor_user_id") references "public"."users"("id") on delete set null;

-- A rule that is later deleted leaves its decisions in the trail, just without the link.
alter table only "public"."purchase_order_event"
  add constraint "purchase_order_event_rule_id_fkey" foreign key ("rule_id") references "public"."purchase_approval_rule"("id") on delete set null;

create index if not exists "purchase_approval_rule_tenant_active_idx"
  on "public"."purchase_approval_rule" ("tenant_id", "active", "threshold");

create index if not exists "purchase_order_event_order_idx"
  on "public"."purchase_order_event" ("purchase_order_id", "created_at");

create or replace trigger "purchase_approval_rule_set_updated_at"
  before update on "public"."purchase_approval_rule"
  for each row execute function "public"."set_updated_at"();

create or replace trigger "purchase_settings_set_updated_at"
  before update on "public"."purchase_settings"
  for each row execute function "public"."set_updated_at"();

alter table "public"."purchase_approval_rule" enable row level security;
alter table "public"."purchase_settings" enable row level security;
alter table "public"."purchase_order_event" enable row level security;

create policy "purchase_approval_rule_tenant_select" on "public"."purchase_approval_rule"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_approval_rule_tenant_insert" on "public"."purchase_approval_rule"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_approval_rule_tenant_update" on "public"."purchase_approval_rule"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_approval_rule_tenant_delete" on "public"."purchase_approval_rule"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_settings_tenant_select" on "public"."purchase_settings"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_settings_tenant_insert" on "public"."purchase_settings"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_settings_tenant_update" on "public"."purchase_settings"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_settings_tenant_delete" on "public"."purchase_settings"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_order_event_tenant_select" on "public"."purchase_order_event"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_order_event_tenant_insert" on "public"."purchase_order_event"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- No update or delete policy on the trail, on purpose, matching the inventory ledger.

grant select, insert, update, delete on table "public"."purchase_approval_rule" to "authenticated";
grant select, insert, update, delete on table "public"."purchase_approval_rule" to "service_role";
grant select, insert, update, delete on table "public"."purchase_settings" to "authenticated";
grant select, insert, update, delete on table "public"."purchase_settings" to "service_role";

-- The append-only guarantee lives in the grants: a policy cannot take away a privilege
-- that was granted.
grant select, insert on table "public"."purchase_order_event" to "authenticated";
revoke update, delete on table "public"."purchase_order_event" from "authenticated";
grant select, insert, update, delete on table "public"."purchase_order_event" to "service_role";

-- Move an order from one status to the next and record why, in one transaction.
--
-- The caller (a server action) has already decided the move is allowed, using the rules
-- in src/lib/purchasing.ts. This function makes it atomic and safe against a second
-- person acting on the same order: the update only lands if the order is still in the
-- status the caller saw, so two approvers clicking at once cannot both win. Security
-- invoker, so row level security still decides whose orders can be touched.
create or replace function "public"."transition_purchase_order"(
  "p_order_id" uuid,
  "p_expected_status" text,
  "p_next_status" text,
  "p_action" text,
  "p_reason" text default null,
  "p_rule_id" uuid default null,
  "p_level" integer default null,
  "p_emergency" boolean default false,
  "p_mark_approved" boolean default false,
  "p_actor_user_id" uuid default null,
  "p_actor_name" text default null
) returns void
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  order_tenant uuid;
begin
  update public.purchase_order
     set status = p_next_status,
         submitted_at = case when p_action = 'submitted' then now() else submitted_at end,
         approved_at = case
           when p_mark_approved then now()
           when p_next_status in ('draft', 'pending_approval', 'rejected') then null
           else approved_at
         end,
         rejected_at = case when p_action = 'rejected' then now() else rejected_at end,
         ordered_at = case
           when p_action = 'ordered' then now()
           when p_action = 'order_undone' then null
           else ordered_at
         end,
         closed_at = case
           when p_action = 'closed' then now()
           when p_action = 'reopened' then null
           else closed_at
         end,
         cancelled_at = case when p_action = 'cancelled' then now() else cancelled_at end
   where id = p_order_id
     and status = p_expected_status
  returning tenant_id into order_tenant;

  if order_tenant is null then
    raise exception 'This order changed while you were looking at it. Reload the page and try again.';
  end if;

  insert into public.purchase_order_event (
    tenant_id, purchase_order_id, action, actor_user_id, actor_name, rule_id, level, reason, emergency
  ) values (
    order_tenant, p_order_id, p_action, p_actor_user_id, p_actor_name, p_rule_id, p_level,
    nullif(btrim(coalesce(p_reason, '')), ''), coalesce(p_emergency, false)
  );
end;
$$;

alter function "public"."transition_purchase_order"(uuid, text, text, text, text, uuid, integer, boolean, boolean, uuid, text) owner to "postgres";

revoke execute on function "public"."transition_purchase_order"(uuid, text, text, text, text, uuid, integer, boolean, boolean, uuid, text) from "public", "anon";
grant execute on function "public"."transition_purchase_order"(uuid, text, text, text, text, uuid, integer, boolean, boolean, uuid, text) to "authenticated", "service_role";
