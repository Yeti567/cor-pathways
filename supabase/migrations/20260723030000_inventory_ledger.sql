-- Inventory module, slice 4: the ledger, and the balances derived from it.
--
-- Two tables that must never disagree, so only one of them is ever written by hand.
--
-- inventory_movement is the truth: an append-only log of "this much of this item went
-- from here to there". It has no UPDATE and no DELETE grant. A mistake is corrected by
-- recording the reversing movement, exactly as a cash book is corrected, which means the
-- history explains itself afterwards instead of quietly becoming a different history.
--
-- inventory_balance is the convenience: how much is at each place right now. It is
-- maintained solely by a trigger on the ledger and carries no write grant at all, so
-- there is no path, through the app or through the API, that can set a quantity without
-- saying where it came from. This is Odoo's "quant" pattern: an immutable move log with
-- a materialized balance beside it.

create table if not exists "public"."inventory_movement" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "item_id" uuid not null,

  -- Always positive. Direction is carried by the two endpoints, never by the sign, so a
  -- negative quantity can never mean two different things.
  "qty" numeric(14,3) not null,

  -- Null means outside the company: stock arriving from a purchase has no origin inside
  -- the system, and stock leaving for good has no destination. At least one end must be
  -- inside, or the row records nothing.
  "from_location_id" uuid,
  "to_location_id" uuid,

  "movement_type" text not null,
  "occurred_at" timestamp with time zone default "now"() not null,
  "note" text,

  -- Offline idempotency. A phone that syncs the same pickup twice must not post it
  -- twice, and the ledger cannot be de-duplicated after the fact by deleting a row.
  "client_uuid" uuid,

  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,

  constraint "inventory_movement_qty_check" check ("qty" > 0),

  constraint "inventory_movement_endpoints_check" check (
    ("from_location_id" is not null or "to_location_id" is not null)
    and ("from_location_id" is distinct from "to_location_id")
  ),

  constraint "inventory_movement_type_check" check (
    "movement_type" = any (array[
      'receive'::text,
      'transfer'::text,
      'consume'::text,
      'write_off'::text,
      'adjustment'::text,
      'reversal'::text
    ])
  )
);

alter table "public"."inventory_movement" owner to "postgres";

comment on table "public"."inventory_movement" is
  'Append-only stock ledger. One row is one movement of one item between two places. No UPDATE or DELETE: corrections are reversing rows, so the history always explains itself.';

comment on column "public"."inventory_movement"."client_uuid" is
  'Client-generated id for offline replay. Unique per tenant, so syncing the same capture twice posts it once.';

create table if not exists "public"."inventory_balance" (
  "tenant_id" uuid not null,
  "item_id" uuid not null,
  "location_id" uuid not null,
  "qty" numeric(14,3) default 0 not null,

  -- Denormalized from the stocking place's kind, because a check constraint cannot join.
  -- Only the two virtual places may go negative: stock in transit or written off is
  -- allowed to run below zero while a mismatch is being resolved, and that residual is
  -- the drift detector. A yard holding minus four mats is always an error.
  "allows_negative" boolean default false not null,

  "updated_at" timestamp with time zone default "now"() not null,

  constraint "inventory_balance_non_negative_check" check ("allows_negative" or "qty" >= 0)
);

alter table "public"."inventory_balance" owner to "postgres";

comment on table "public"."inventory_balance" is
  'How much of each item sits at each stocking place. Derived entirely from inventory_movement by trigger, and writable by nothing else: there is no supported path that sets a quantity without recording where it came from.';

alter table only "public"."inventory_movement"
  add constraint "inventory_movement_pkey" primary key ("id");

alter table only "public"."inventory_balance"
  add constraint "inventory_balance_pkey" primary key ("tenant_id", "item_id", "location_id");

alter table only "public"."inventory_movement"
  add constraint "inventory_movement_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

-- Restrict, not cascade, on everything the ledger points at. Deleting an item or a place
-- that has history must fail loudly rather than silently rewriting the past. Items are
-- soft deleted for exactly this reason.
alter table only "public"."inventory_movement"
  add constraint "inventory_movement_item_id_fkey" foreign key ("item_id") references "public"."inventory_item"("id") on delete restrict;

alter table only "public"."inventory_movement"
  add constraint "inventory_movement_from_location_id_fkey" foreign key ("from_location_id") references "public"."inventory_location"("id") on delete restrict;

alter table only "public"."inventory_movement"
  add constraint "inventory_movement_to_location_id_fkey" foreign key ("to_location_id") references "public"."inventory_location"("id") on delete restrict;

alter table only "public"."inventory_movement"
  add constraint "inventory_movement_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."inventory_balance"
  add constraint "inventory_balance_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."inventory_balance"
  add constraint "inventory_balance_item_id_fkey" foreign key ("item_id") references "public"."inventory_item"("id") on delete restrict;

alter table only "public"."inventory_balance"
  add constraint "inventory_balance_location_id_fkey" foreign key ("location_id") references "public"."inventory_location"("id") on delete restrict;

create unique index if not exists "inventory_movement_tenant_client_uuid_key"
  on "public"."inventory_movement" ("tenant_id", "client_uuid") where "client_uuid" is not null;

create index if not exists "inventory_movement_tenant_occurred_idx"
  on "public"."inventory_movement" ("tenant_id", "occurred_at" desc);

create index if not exists "inventory_movement_tenant_item_idx"
  on "public"."inventory_movement" ("tenant_id", "item_id", "occurred_at" desc);

create index if not exists "inventory_movement_from_idx"
  on "public"."inventory_movement" ("from_location_id", "occurred_at" desc) where "from_location_id" is not null;

create index if not exists "inventory_movement_to_idx"
  on "public"."inventory_movement" ("to_location_id", "occurred_at" desc) where "to_location_id" is not null;

create index if not exists "inventory_balance_tenant_location_idx"
  on "public"."inventory_balance" ("tenant_id", "location_id");

-- The one writer of balances.
--
-- SECURITY DEFINER because `authenticated` deliberately holds no write grant on
-- inventory_balance: the only way a quantity may change is by posting a movement. The
-- search_path is pinned so the definer rights cannot be redirected at another schema.
create or replace function "public"."apply_inventory_movement"() returns "trigger"
    language "plpgsql" security definer
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  place_allows_negative boolean;
  current_qty numeric(14,3);
  place_name text;
begin
  -- Take the stock off the origin first, so an overdraw fails before anything is added
  -- anywhere.
  if new.from_location_id is not null then
    select il.kind in ('transit', 'loss')
      into place_allows_negative
      from public.inventory_location il
     where il.id = new.from_location_id
       and il.tenant_id = new.tenant_id;

    if place_allows_negative is null then
      raise exception 'Stocking place % does not belong to this tenant', new.from_location_id
        using errcode = 'foreign_key_violation';
    end if;

    -- Seed the row at zero rather than inserting the delta. Postgres evaluates CHECK
    -- constraints on the proposed row BEFORE ON CONFLICT resolves it, so inserting a
    -- negative delta trips the non-negative constraint even when the settled balance
    -- would be perfectly fine. Zero is always valid, so the update below is what moves
    -- the number.
    insert into public.inventory_balance (tenant_id, item_id, location_id, qty, allows_negative)
    values (new.tenant_id, new.item_id, new.from_location_id, 0, place_allows_negative)
    on conflict (tenant_id, item_id, location_id) do nothing;

    -- FOR UPDATE serializes two movements drawing on the same place at once. Without it
    -- both could read the same balance and each take the last of the stock.
    select qty into current_qty
      from public.inventory_balance
     where tenant_id = new.tenant_id
       and item_id = new.item_id
       and location_id = new.from_location_id
       for update;

    -- The constraint would catch this too, but it would report a constraint name. Say
    -- what actually went wrong, and where, before attempting the write.
    if not place_allows_negative and current_qty - new.qty < 0 then
      select coalesce(il.name, l.name, e.unit_number, u.full_name, 'that place')
        into place_name
        from public.inventory_location il
        left join public.locations l on l.id = il.location_id
        left join public.equipment e on e.id = il.equipment_id
        left join public.users u on u.id = il.user_id
       where il.id = new.from_location_id;

      raise exception 'Not enough stock at %. It holds %, and this would take %.',
        place_name, current_qty, new.qty
        using errcode = 'check_violation';
    end if;

    update public.inventory_balance
       set qty = current_qty - new.qty,
           allows_negative = place_allows_negative,
           updated_at = now()
     where tenant_id = new.tenant_id
       and item_id = new.item_id
       and location_id = new.from_location_id;
  end if;

  if new.to_location_id is not null then
    select il.kind in ('transit', 'loss')
      into place_allows_negative
      from public.inventory_location il
     where il.id = new.to_location_id
       and il.tenant_id = new.tenant_id;

    if place_allows_negative is null then
      raise exception 'Stocking place % does not belong to this tenant', new.to_location_id
        using errcode = 'foreign_key_violation';
    end if;

    insert into public.inventory_balance (tenant_id, item_id, location_id, qty, allows_negative)
    values (new.tenant_id, new.item_id, new.to_location_id, 0, place_allows_negative)
    on conflict (tenant_id, item_id, location_id) do nothing;

    update public.inventory_balance
       set qty = qty + new.qty,
           allows_negative = place_allows_negative,
           updated_at = now()
     where tenant_id = new.tenant_id
       and item_id = new.item_id
       and location_id = new.to_location_id;
  end if;

  return new;
end;
$$;

alter function "public"."apply_inventory_movement"() owner to "postgres";

-- AFTER INSERT, so the row exists before balances move. There is deliberately no update
-- or delete trigger: the ledger does not support either.
create or replace trigger "inventory_movement_apply"
  after insert on "public"."inventory_movement"
  for each row execute function "public"."apply_inventory_movement"();

alter table "public"."inventory_movement" enable row level security;
alter table "public"."inventory_balance" enable row level security;

create policy "inventory_movement_tenant_select" on "public"."inventory_movement"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_movement_tenant_insert" on "public"."inventory_movement"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- No update or delete policy on the ledger, on purpose.

create policy "inventory_balance_tenant_select" on "public"."inventory_balance"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- No insert, update, or delete policy on balances, on purpose.

-- Grants. Row level security does not grant table access, and a policy cannot take a
-- privilege away that was granted, so the append-only guarantee lives here.
grant select, insert on table "public"."inventory_movement" to "authenticated";
revoke update, delete on table "public"."inventory_movement" from "authenticated";
grant select, insert, update, delete on table "public"."inventory_movement" to "service_role";

grant select on table "public"."inventory_balance" to "authenticated";
revoke insert, update, delete on table "public"."inventory_balance" from "authenticated";
grant select, insert, update, delete on table "public"."inventory_balance" to "service_role";
