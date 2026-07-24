-- Inventory module, slice 8: counts and reconciliation.
--
-- A count is the one place a person states an absolute quantity: "there are 46 mats in
-- the yard". Everywhere else in the module a quantity is only ever moved, never set. A
-- count keeps that promise by NOT writing the balance either. It reads what the books say,
-- takes the physical number the person counted, and posts the difference as an ordinary
-- adjustment movement into the virtual loss place. The balance then falls out of the
-- ledger exactly as it always does, and the loss place becomes the running record of
-- shrinkage, reviewable rather than a black hole.
--
-- Two things are written: an adjustment movement (the delta, the thing that moves the
-- balance) and an inventory_count row (the audit record that also remembers the absolute
-- counted and expected figures, which the delta alone throws away). They must both land
-- or neither, so they are written together inside record_inventory_count, in one
-- transaction, rather than by two round trips from the app that could half-fail.

create table if not exists "public"."inventory_count" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "item_id" uuid not null,

  -- The real place that was counted. Never the virtual loss or transit place: you count
  -- what is physically somewhere, and the reconciliation is what touches loss.
  "location_id" uuid not null,

  -- The absolute number the person counted. Zero is a legitimate count (the shelf is
  -- empty); it is not the same as never having counted.
  "counted_qty" numeric(14,3) not null,

  -- What the balance said at the moment of counting. Kept because the movement records
  -- only the delta, and "we counted 46, the books said 50" is the sentence a variance
  -- review needs a year later.
  "expected_qty" numeric(14,3) not null,

  -- counted minus expected. Negative is a shortage, positive is a windfall. Stored rather
  -- than recomputed so the row is self-contained, and pinned to the other two by a check.
  "delta" numeric(14,3) not null,

  -- The adjustment movement this count posted. Null exactly when the count matched the
  -- books and nothing needed moving.
  "movement_id" uuid,

  "note" text,
  "counted_at" timestamp with time zone default "now"() not null,
  "counted_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,

  constraint "inventory_count_counted_qty_check" check ("counted_qty" >= 0),

  -- The three numbers cannot disagree. This is what makes the stored delta trustworthy
  -- instead of merely usually right.
  constraint "inventory_count_delta_check" check ("delta" = "counted_qty" - "expected_qty"),

  -- A count that changed nothing posts no movement; a count that changed something must
  -- point at the movement it posted. Neither half can exist without the other.
  constraint "inventory_count_movement_presence_check" check (
    ("delta" = 0) = ("movement_id" is null)
  )
);

alter table "public"."inventory_count" owner to "postgres";

comment on table "public"."inventory_count" is
  'A physical count: the absolute quantity someone counted at a place, the balance it was measured against, and the adjustment movement the difference posted. The balance is never written here; the movement moves it.';

alter table only "public"."inventory_count"
  add constraint "inventory_count_pkey" primary key ("id");

alter table only "public"."inventory_count"
  add constraint "inventory_count_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

-- Restrict on everything the count points at, matching the ledger. A count is history, and
-- deleting the item, place, or movement it refers to must fail loudly rather than quietly
-- rewriting what was counted.
alter table only "public"."inventory_count"
  add constraint "inventory_count_item_id_fkey" foreign key ("item_id") references "public"."inventory_item"("id") on delete restrict;

alter table only "public"."inventory_count"
  add constraint "inventory_count_location_id_fkey" foreign key ("location_id") references "public"."inventory_location"("id") on delete restrict;

alter table only "public"."inventory_count"
  add constraint "inventory_count_movement_id_fkey" foreign key ("movement_id") references "public"."inventory_movement"("id") on delete restrict;

alter table only "public"."inventory_count"
  add constraint "inventory_count_counted_by_fkey" foreign key ("counted_by") references "public"."users"("id") on delete set null;

create index if not exists "inventory_count_tenant_counted_idx"
  on "public"."inventory_count" ("tenant_id", "counted_at" desc);

create index if not exists "inventory_count_tenant_item_place_idx"
  on "public"."inventory_count" ("tenant_id", "item_id", "location_id", "counted_at" desc);

alter table "public"."inventory_count" enable row level security;

create policy "inventory_count_tenant_select" on "public"."inventory_count"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_count_tenant_insert" on "public"."inventory_count"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- No update or delete policy: a count is a historical statement, corrected by counting
-- again, not by editing what a past count said.

grant select, insert on table "public"."inventory_count" to "authenticated";
revoke update, delete on table "public"."inventory_count" from "authenticated";
grant select, insert, update, delete on table "public"."inventory_count" to "service_role";

-- Reconcile a count against the books, atomically.
--
-- SECURITY INVOKER, so every statement is checked against the caller's own row level
-- security: the balance read, the movement insert, and the count insert all pass through
-- the same policies a hand-recorded movement would, and nothing here can write into a
-- tenant the caller is not a member of. The one privileged step, moving the balance, is
-- already handled by the SECURITY DEFINER trigger that fires on the movement insert.
--
-- The whole thing is one function so the adjustment and the count row share a transaction.
-- If either fails, both roll back, and the ledger is never left holding an adjustment that
-- no count explains, nor a count that claims a movement that is not there.
create or replace function "public"."record_inventory_count"(
  "p_tenant_id" uuid,
  "p_item_id" uuid,
  "p_location_id" uuid,
  "p_counted_qty" numeric,
  "p_note" text,
  "p_actor" uuid
) returns "public"."inventory_count"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  v_expected numeric(14,3);
  v_delta numeric(14,3);
  v_loss_id uuid;
  v_movement_id uuid;
  v_count public.inventory_count;
  v_note text := nullif(btrim(p_note), '');
begin
  if p_counted_qty is null or p_counted_qty < 0 then
    raise exception 'A count cannot be negative. Enter how many are actually there, or zero.'
      using errcode = 'check_violation';
  end if;

  -- The books figure. A missing row means zero on hand. Deliberately not locked here: a
  -- locking read as the invoker would drag in inventory_balance's UPDATE policies, of
  -- which there are none, so it would see nothing. The balance mutation itself is already
  -- serialized by the FOR UPDATE inside the movement trigger, which runs as the owner.
  select qty into v_expected
    from public.inventory_balance
   where tenant_id = p_tenant_id
     and item_id = p_item_id
     and location_id = p_location_id;

  v_expected := coalesce(v_expected, 0);
  v_delta := round(p_counted_qty, 3) - v_expected;

  if v_delta <> 0 then
    select id into v_loss_id
      from public.inventory_location
     where tenant_id = p_tenant_id
       and kind = 'loss';

    if v_loss_id is null then
      raise exception 'The loss place is missing. Switch the Inventory module off and on again under Setup to restore it.'
        using errcode = 'no_data_found';
    end if;

    -- A shortage moves the missing stock out to loss; a windfall pulls it back from loss.
    -- Either way the quantity is positive and the direction lives in the two endpoints,
    -- exactly like every other movement.
    insert into public.inventory_movement (
      tenant_id, item_id, qty, from_location_id, to_location_id, movement_type, note, created_by
    ) values (
      p_tenant_id,
      p_item_id,
      abs(v_delta),
      case when v_delta < 0 then p_location_id else v_loss_id end,
      case when v_delta < 0 then v_loss_id else p_location_id end,
      'adjustment',
      coalesce(v_note, 'Physical count'),
      p_actor
    )
    returning id into v_movement_id;
  end if;

  insert into public.inventory_count (
    tenant_id, item_id, location_id, counted_qty, expected_qty, delta, movement_id, note, counted_by
  ) values (
    p_tenant_id,
    p_item_id,
    p_location_id,
    round(p_counted_qty, 3),
    v_expected,
    v_delta,
    v_movement_id,
    v_note,
    p_actor
  )
  returning * into v_count;

  return v_count;
end;
$$;

alter function "public"."record_inventory_count"(uuid, uuid, uuid, numeric, text, uuid) owner to "postgres";

-- Callable by signed-in users only. Definer-rights escalation is not needed because the
-- function runs as the caller; anon has no business reconciling stock.
revoke execute on function "public"."record_inventory_count"(uuid, uuid, uuid, numeric, text, uuid) from "public", "anon";
grant execute on function "public"."record_inventory_count"(uuid, uuid, uuid, numeric, text, uuid) to "authenticated", "service_role";
