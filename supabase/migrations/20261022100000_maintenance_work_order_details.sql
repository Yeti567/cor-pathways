-- Maintenance module: what goes on a work order.
--
--   maintenance_work_order_task     the checklist, with who ticked each row and when
--   maintenance_work_order_labour   who worked, on which day, how long, at what rate
--   maintenance_work_order_part     parts from inventory or described in words; a stock
--                                   part is issued through the inventory ledger and keeps
--                                   the movement it posted
--   maintenance_work_order_cost     outside vendor work and other costs, including the
--                                   cost of a purchase order line received for the job
--   maintenance_work_order_note     the notes thread, append-only
--   maintenance_work_order_event    the status trail, append-only, written only by the
--                                   functions in 20261022110000
--
-- The work order's cost columns are a roll-up of the labour, parts and cost rows, kept
-- by one trigger here so the screens, the equipment history and a report can never
-- disagree about what a job cost.
--
-- Who may write which row, and when the costs lock, is enforced by the guard triggers in
-- 20261022120000. This file holds the shape and the arithmetic.

-- --- Tasks -----------------------------------------------------------------------

create table if not exists "public"."maintenance_work_order_task" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "work_order_id" uuid not null,
  "position" integer default 1 not null,
  "title" text not null,
  "done" boolean default false not null,
  "done_by" uuid,
  "done_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "maintenance_work_order_task_title_check" check (nullif(btrim("title"), '') is not null),
  constraint "maintenance_work_order_task_done_check" check ("done" = ("done_at" is not null))
);

alter table "public"."maintenance_work_order_task" owner to "postgres";

comment on table "public"."maintenance_work_order_task" is
  'A checklist row on a maintenance work order, with who ticked it and when.';

-- --- Labour ----------------------------------------------------------------------

create table if not exists "public"."maintenance_work_order_labour" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "work_order_id" uuid not null,
  "worker_id" uuid,
  "worked_on" date default current_date not null,
  "hours" numeric(8,2) not null,
  "rate" numeric(14,2) default 0 not null,
  "cost" numeric(14,2) default 0 not null,
  "note" text,

  -- Offline idempotency, as on the inventory ledger: a phone that syncs the same time
  -- entry twice posts it once.
  "client_uuid" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "maintenance_work_order_labour_hours_check" check ("hours" > 0 and "hours" <= 24),
  constraint "maintenance_work_order_labour_rate_check" check ("rate" >= 0),

  -- The cost is arithmetic, so a report summing cost can never disagree with one summing
  -- hours times rate.
  constraint "maintenance_work_order_labour_cost_check" check ("cost" = round("hours" * "rate", 2))
);

alter table "public"."maintenance_work_order_labour" owner to "postgres";

comment on table "public"."maintenance_work_order_labour" is
  'Time worked on a maintenance work order: who, which day, how many hours, and the cost at the rate entered.';

-- --- Parts -----------------------------------------------------------------------

create table if not exists "public"."maintenance_work_order_part" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "work_order_id" uuid not null,

  -- An inventory item, or null for a part described in words.
  "item_id" uuid,
  "description" text not null,
  "unit" text default 'each'::text not null,
  "qty" numeric(14,3) not null,
  "unit_cost" numeric(14,4) default 0 not null,
  "line_total" numeric(14,2) default 0 not null,

  -- planned   listed for the job, not used yet; no cost
  -- issued    used on the job; a stock part was issued out of a place through the ledger
  -- returned  issued, then put back through the ledger; no cost
  -- received  bought for the job on a purchase order and received against it
  "status" text default 'planned'::text not null,

  -- Needs buying. A planned part with this set can be put on a purchase order.
  "to_order" boolean default false not null,

  -- Where a stock part was issued from, and the ledger movements it posted.
  "place_id" uuid,
  "movement_id" uuid,
  "return_movement_id" uuid,
  "issued_at" timestamp with time zone,
  "issued_by" uuid,
  "returned_at" timestamp with time zone,
  "received_at" timestamp with time zone,

  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "maintenance_work_order_part_status_check" check (
    "status" = any (array['planned'::text, 'issued'::text, 'returned'::text, 'received'::text])
  ),

  constraint "maintenance_work_order_part_qty_check" check ("qty" > 0),
  constraint "maintenance_work_order_part_cost_check" check ("unit_cost" >= 0 and "line_total" >= 0),
  constraint "maintenance_work_order_part_total_check" check ("line_total" = round("qty" * "unit_cost", 2)),

  -- A stock part that was issued says which ledger movement took it off the shelf, and a
  -- returned one says which movement put it back. Nothing leaves stock unexplained.
  constraint "maintenance_work_order_part_issue_movement_check" check (
    "item_id" is null or "status" not in ('issued', 'returned') or ("movement_id" is not null and "place_id" is not null)
  ),
  constraint "maintenance_work_order_part_return_movement_check" check (
    "item_id" is null or "status" <> 'returned' or "return_movement_id" is not null
  )
);

alter table "public"."maintenance_work_order_part" owner to "postgres";

comment on table "public"."maintenance_work_order_part" is
  'A part for a maintenance work order: from inventory (issued and returned through the ledger) or described in words, or bought for the job on a purchase order.';

-- --- Outside and other costs -------------------------------------------------------

create table if not exists "public"."maintenance_work_order_cost" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "work_order_id" uuid not null,
  "kind" text default 'vendor'::text not null,
  "supplier_id" uuid,
  "description" text not null,
  "reference" text,
  "amount" numeric(14,2) not null,
  "incurred_on" date default current_date not null,

  -- Set when the cost was landed by receiving a purchase order line for this job.
  "purchase_receipt_line_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "maintenance_work_order_cost_kind_check" check ("kind" = any (array['vendor'::text, 'other'::text])),
  constraint "maintenance_work_order_cost_amount_check" check ("amount" >= 0),
  constraint "maintenance_work_order_cost_description_check" check (nullif(btrim("description"), '') is not null)
);

alter table "public"."maintenance_work_order_cost" owner to "postgres";

comment on table "public"."maintenance_work_order_cost" is
  'Outside vendor work and other costs on a maintenance work order, including purchase order lines received for the job.';

-- --- Notes -----------------------------------------------------------------------

create table if not exists "public"."maintenance_work_order_note" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "work_order_id" uuid not null,
  "author_id" uuid,
  "author_name" text,
  "body" text not null,
  "created_at" timestamp with time zone default "now"() not null,

  constraint "maintenance_work_order_note_body_check" check (nullif(btrim("body"), '') is not null)
);

alter table "public"."maintenance_work_order_note" owner to "postgres";

comment on table "public"."maintenance_work_order_note" is
  'The notes thread on a maintenance work order. Append-only; the author is whoever is signed in.';

-- --- The trail ---------------------------------------------------------------------

create table if not exists "public"."maintenance_work_order_event" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "work_order_id" uuid not null,
  "action" text not null,
  "from_status" text,
  "to_status" text,
  "actor_user_id" uuid,
  "actor_name" text,
  "reason" text,
  "created_at" timestamp with time zone default "now"() not null,

  constraint "maintenance_work_order_event_action_check" check (
    "action" = any (array[
      'created'::text,
      'approved'::text,
      'assigned'::text,
      'started'::text,
      'held'::text,
      'completed'::text,
      'closed'::text,
      'cancelled'::text,
      'reopened'::text,
      'part_issued'::text,
      'part_returned'::text,
      'cost_received'::text
    ])
  )
);

alter table "public"."maintenance_work_order_event" owner to "postgres";

comment on table "public"."maintenance_work_order_event" is
  'The append-only trail of a maintenance work order: every status change and every stock or purchase posting, with who did it.';

-- --- Keys --------------------------------------------------------------------------

alter table only "public"."maintenance_work_order_task" add constraint "maintenance_work_order_task_pkey" primary key ("id");
alter table only "public"."maintenance_work_order_labour" add constraint "maintenance_work_order_labour_pkey" primary key ("id");
alter table only "public"."maintenance_work_order_part" add constraint "maintenance_work_order_part_pkey" primary key ("id");
alter table only "public"."maintenance_work_order_cost" add constraint "maintenance_work_order_cost_pkey" primary key ("id");
alter table only "public"."maintenance_work_order_note" add constraint "maintenance_work_order_note_pkey" primary key ("id");
alter table only "public"."maintenance_work_order_event" add constraint "maintenance_work_order_event_pkey" primary key ("id");

alter table only "public"."maintenance_work_order_task"
  add constraint "maintenance_work_order_task_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;
alter table only "public"."maintenance_work_order_task"
  add constraint "maintenance_work_order_task_work_order_id_fkey" foreign key ("work_order_id") references "public"."maintenance_work_order"("id") on delete cascade;
alter table only "public"."maintenance_work_order_task"
  add constraint "maintenance_work_order_task_done_by_fkey" foreign key ("done_by") references "public"."users"("id") on delete set null;
alter table only "public"."maintenance_work_order_task"
  add constraint "maintenance_work_order_task_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."maintenance_work_order_labour"
  add constraint "maintenance_work_order_labour_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;
alter table only "public"."maintenance_work_order_labour"
  add constraint "maintenance_work_order_labour_work_order_id_fkey" foreign key ("work_order_id") references "public"."maintenance_work_order"("id") on delete cascade;
alter table only "public"."maintenance_work_order_labour"
  add constraint "maintenance_work_order_labour_worker_id_fkey" foreign key ("worker_id") references "public"."users"("id") on delete set null;
alter table only "public"."maintenance_work_order_labour"
  add constraint "maintenance_work_order_labour_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."maintenance_work_order_part"
  add constraint "maintenance_work_order_part_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;
-- Restrict: a part that moved stock keeps its work order, so the ledger stays explained.
alter table only "public"."maintenance_work_order_part"
  add constraint "maintenance_work_order_part_work_order_id_fkey" foreign key ("work_order_id") references "public"."maintenance_work_order"("id") on delete restrict;
alter table only "public"."maintenance_work_order_part"
  add constraint "maintenance_work_order_part_item_id_fkey" foreign key ("item_id") references "public"."inventory_item"("id") on delete restrict;
alter table only "public"."maintenance_work_order_part"
  add constraint "maintenance_work_order_part_place_id_fkey" foreign key ("place_id") references "public"."inventory_location"("id") on delete restrict;
alter table only "public"."maintenance_work_order_part"
  add constraint "maintenance_work_order_part_movement_id_fkey" foreign key ("movement_id") references "public"."inventory_movement"("id") on delete restrict;
alter table only "public"."maintenance_work_order_part"
  add constraint "maintenance_work_order_part_return_movement_id_fkey" foreign key ("return_movement_id") references "public"."inventory_movement"("id") on delete restrict;
alter table only "public"."maintenance_work_order_part"
  add constraint "maintenance_work_order_part_issued_by_fkey" foreign key ("issued_by") references "public"."users"("id") on delete set null;
alter table only "public"."maintenance_work_order_part"
  add constraint "maintenance_work_order_part_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."maintenance_work_order_cost"
  add constraint "maintenance_work_order_cost_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;
alter table only "public"."maintenance_work_order_cost"
  add constraint "maintenance_work_order_cost_work_order_id_fkey" foreign key ("work_order_id") references "public"."maintenance_work_order"("id") on delete cascade;
alter table only "public"."maintenance_work_order_cost"
  add constraint "maintenance_work_order_cost_supplier_id_fkey" foreign key ("supplier_id") references "public"."supplier"("id") on delete set null;
alter table only "public"."maintenance_work_order_cost"
  add constraint "maintenance_work_order_cost_purchase_receipt_line_id_fkey" foreign key ("purchase_receipt_line_id") references "public"."purchase_receipt_line"("id") on delete restrict;
alter table only "public"."maintenance_work_order_cost"
  add constraint "maintenance_work_order_cost_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."maintenance_work_order_note"
  add constraint "maintenance_work_order_note_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;
alter table only "public"."maintenance_work_order_note"
  add constraint "maintenance_work_order_note_work_order_id_fkey" foreign key ("work_order_id") references "public"."maintenance_work_order"("id") on delete cascade;
alter table only "public"."maintenance_work_order_note"
  add constraint "maintenance_work_order_note_author_id_fkey" foreign key ("author_id") references "public"."users"("id") on delete set null;

alter table only "public"."maintenance_work_order_event"
  add constraint "maintenance_work_order_event_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;
alter table only "public"."maintenance_work_order_event"
  add constraint "maintenance_work_order_event_work_order_id_fkey" foreign key ("work_order_id") references "public"."maintenance_work_order"("id") on delete cascade;
alter table only "public"."maintenance_work_order_event"
  add constraint "maintenance_work_order_event_actor_user_id_fkey" foreign key ("actor_user_id") references "public"."users"("id") on delete set null;

create index if not exists "maintenance_work_order_task_order_idx"
  on "public"."maintenance_work_order_task" ("work_order_id", "position");
create index if not exists "maintenance_work_order_labour_order_idx"
  on "public"."maintenance_work_order_labour" ("work_order_id", "worked_on");
create unique index if not exists "maintenance_work_order_labour_client_uuid_key"
  on "public"."maintenance_work_order_labour" ("tenant_id", "client_uuid") where "client_uuid" is not null;
create index if not exists "maintenance_work_order_part_order_idx"
  on "public"."maintenance_work_order_part" ("work_order_id", "created_at");
create index if not exists "maintenance_work_order_cost_order_idx"
  on "public"."maintenance_work_order_cost" ("work_order_id", "incurred_on");
create unique index if not exists "maintenance_work_order_cost_receipt_line_key"
  on "public"."maintenance_work_order_cost" ("purchase_receipt_line_id") where "purchase_receipt_line_id" is not null;
create index if not exists "maintenance_work_order_note_order_idx"
  on "public"."maintenance_work_order_note" ("work_order_id", "created_at");
create index if not exists "maintenance_work_order_event_order_idx"
  on "public"."maintenance_work_order_event" ("work_order_id", "created_at");

create or replace trigger "maintenance_work_order_task_set_updated_at"
  before update on "public"."maintenance_work_order_task"
  for each row execute function "public"."set_updated_at"();
create or replace trigger "maintenance_work_order_labour_set_updated_at"
  before update on "public"."maintenance_work_order_labour"
  for each row execute function "public"."set_updated_at"();
create or replace trigger "maintenance_work_order_part_set_updated_at"
  before update on "public"."maintenance_work_order_part"
  for each row execute function "public"."set_updated_at"();
create or replace trigger "maintenance_work_order_cost_set_updated_at"
  before update on "public"."maintenance_work_order_cost"
  for each row execute function "public"."set_updated_at"();

-- --- The write flag ------------------------------------------------------------------

-- The functions in 20261022110000 and the triggers below set the transaction-local
-- setting app.maintenance_write around their own writes; the guard triggers in
-- 20261022120000 let a write through when it is on. Defined here because the roll-up
-- below needs it before the guards exist.
create or replace function "public"."maintenance_write_open"() returns boolean
    language "sql" stable
    set "search_path" to 'pg_temp'
    as $$
  select coalesce(current_setting('app.maintenance_write', true), '') = 'on';
$$;

alter function "public"."maintenance_write_open"() owner to "postgres";
revoke execute on function "public"."maintenance_write_open"() from public, "anon";
grant execute on function "public"."maintenance_write_open"() to "authenticated", "service_role";

-- --- The cost roll-up ----------------------------------------------------------------

-- Recomputes one work order's cost columns from its rows. Labour counts as entered; a
-- part counts once it is issued or received, and stops counting when it is returned;
-- costs count by kind. The previous value of the write flag is restored afterwards, so a
-- function that is part way through its own writes keeps its door open.
create or replace function "public"."refresh_maintenance_work_order_costs"("p_work_order_id" uuid) returns void
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  labour numeric(14,2);
  parts numeric(14,2);
  vendor numeric(14,2);
  other numeric(14,2);
  previous_flag text := coalesce(current_setting('app.maintenance_write', true), '');
begin
  select coalesce(sum(l.cost), 0) into labour
    from public.maintenance_work_order_labour l
   where l.work_order_id = p_work_order_id;

  select coalesce(sum(p.line_total), 0) into parts
    from public.maintenance_work_order_part p
   where p.work_order_id = p_work_order_id
     and p.status in ('issued', 'received');

  select coalesce(sum(c.amount) filter (where c.kind = 'vendor'), 0),
         coalesce(sum(c.amount) filter (where c.kind = 'other'), 0)
    into vendor, other
    from public.maintenance_work_order_cost c
   where c.work_order_id = p_work_order_id;

  perform set_config('app.maintenance_write', 'on', true);

  update public.maintenance_work_order
     set labour_cost = labour,
         parts_cost = parts,
         vendor_cost = vendor,
         other_cost = other,
         total_cost = labour + parts + vendor + other
   where id = p_work_order_id
     and (labour_cost, parts_cost, vendor_cost, other_cost) is distinct from (labour, parts, vendor, other);

  perform set_config('app.maintenance_write', previous_flag, true);
end;
$$;

alter function "public"."refresh_maintenance_work_order_costs"(uuid) owner to "postgres";

-- Callable by members because the cost triggers below call it as the person writing the
-- row (a nested call checks EXECUTE, a trigger does not). It can only ever write the true
-- sums of rows that person can already see, so it opens nothing.
revoke execute on function "public"."refresh_maintenance_work_order_costs"(uuid) from public, "anon";
grant execute on function "public"."refresh_maintenance_work_order_costs"(uuid) to "authenticated", "service_role";

create or replace function "public"."maintenance_work_order_costs_changed"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_maintenance_work_order_costs(old.work_order_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id then
      perform public.refresh_maintenance_work_order_costs(new.work_order_id);
    end if;
    return new;
  end if;

  return old;
end;
$$;

alter function "public"."maintenance_work_order_costs_changed"() owner to "postgres";
revoke execute on function "public"."maintenance_work_order_costs_changed"() from public, "anon", "authenticated";

create or replace trigger "maintenance_work_order_labour_costs"
  after insert or update or delete on "public"."maintenance_work_order_labour"
  for each row execute function "public"."maintenance_work_order_costs_changed"();

create or replace trigger "maintenance_work_order_part_costs"
  after insert or update or delete on "public"."maintenance_work_order_part"
  for each row execute function "public"."maintenance_work_order_costs_changed"();

create or replace trigger "maintenance_work_order_cost_costs"
  after insert or update or delete on "public"."maintenance_work_order_cost"
  for each row execute function "public"."maintenance_work_order_costs_changed"();

-- --- The first line of the trail -------------------------------------------------------

-- Every work order starts its trail with who raised it, written here so nobody has to
-- write (or can forge) a "created" row by hand.
create or replace function "public"."maintenance_work_order_created"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  previous_flag text := coalesce(current_setting('app.maintenance_write', true), '');
  actor_label text;
begin
  select coalesce(nullif(btrim(u.full_name), ''), u.email) into actor_label
    from public.users u
   where u.id = auth.uid();

  perform set_config('app.maintenance_write', 'on', true);

  insert into public.maintenance_work_order_event (
    tenant_id, work_order_id, action, to_status, actor_user_id, actor_name, reason, created_at
  ) values (
    new.tenant_id, new.id, 'created', new.status, auth.uid(),
    coalesce(actor_label, 'Automatic'),
    case new.source
      when 'follow_up' then 'Raised from a corrective action.'
      when 'scheduled_service' then 'Raised because a scheduled service came due.'
      when 'inspection' then 'Raised by a failed inspection item.'
      when 'service_request' then 'Raised from a service request.'
      else null
    end,
    clock_timestamp()
  );

  perform set_config('app.maintenance_write', previous_flag, true);

  return new;
end;
$$;

alter function "public"."maintenance_work_order_created"() owner to "postgres";
revoke execute on function "public"."maintenance_work_order_created"() from public, "anon", "authenticated";

create or replace trigger "maintenance_work_order_log_created"
  after insert on "public"."maintenance_work_order"
  for each row execute function "public"."maintenance_work_order_created"();

-- --- Row level security and grants ---------------------------------------------------

alter table "public"."maintenance_work_order_task" enable row level security;
alter table "public"."maintenance_work_order_labour" enable row level security;
alter table "public"."maintenance_work_order_part" enable row level security;
alter table "public"."maintenance_work_order_cost" enable row level security;
alter table "public"."maintenance_work_order_note" enable row level security;
alter table "public"."maintenance_work_order_event" enable row level security;

create policy "maintenance_work_order_task_tenant_select" on "public"."maintenance_work_order_task"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_task_tenant_insert" on "public"."maintenance_work_order_task"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_task_tenant_update" on "public"."maintenance_work_order_task"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_task_tenant_delete" on "public"."maintenance_work_order_task"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "maintenance_work_order_labour_tenant_select" on "public"."maintenance_work_order_labour"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_labour_tenant_insert" on "public"."maintenance_work_order_labour"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_labour_tenant_update" on "public"."maintenance_work_order_labour"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_labour_tenant_delete" on "public"."maintenance_work_order_labour"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "maintenance_work_order_part_tenant_select" on "public"."maintenance_work_order_part"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_part_tenant_insert" on "public"."maintenance_work_order_part"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_part_tenant_update" on "public"."maintenance_work_order_part"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_part_tenant_delete" on "public"."maintenance_work_order_part"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "maintenance_work_order_cost_tenant_select" on "public"."maintenance_work_order_cost"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_cost_tenant_insert" on "public"."maintenance_work_order_cost"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_cost_tenant_update" on "public"."maintenance_work_order_cost"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_cost_tenant_delete" on "public"."maintenance_work_order_cost"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- Notes and the trail are append-only: select and insert policies only, matching the
-- grants below.
create policy "maintenance_work_order_note_tenant_select" on "public"."maintenance_work_order_note"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_note_tenant_insert" on "public"."maintenance_work_order_note"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "maintenance_work_order_event_tenant_select" on "public"."maintenance_work_order_event"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));
create policy "maintenance_work_order_event_tenant_insert" on "public"."maintenance_work_order_event"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

grant select, insert, update, delete on table "public"."maintenance_work_order_task" to "authenticated";
grant select, insert, update, delete on table "public"."maintenance_work_order_task" to "service_role";
grant select, insert, update, delete on table "public"."maintenance_work_order_labour" to "authenticated";
grant select, insert, update, delete on table "public"."maintenance_work_order_labour" to "service_role";
grant select, insert, update, delete on table "public"."maintenance_work_order_part" to "authenticated";
grant select, insert, update, delete on table "public"."maintenance_work_order_part" to "service_role";
grant select, insert, update, delete on table "public"."maintenance_work_order_cost" to "authenticated";
grant select, insert, update, delete on table "public"."maintenance_work_order_cost" to "service_role";

grant select, insert on table "public"."maintenance_work_order_note" to "authenticated";
revoke update, delete on table "public"."maintenance_work_order_note" from "authenticated";
grant select, insert, update, delete on table "public"."maintenance_work_order_note" to "service_role";

grant select, insert on table "public"."maintenance_work_order_event" to "authenticated";
revoke update, delete on table "public"."maintenance_work_order_event" from "authenticated";
grant select, insert, update, delete on table "public"."maintenance_work_order_event" to "service_role";
