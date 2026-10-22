-- Purchasing meets maintenance: orders for a work order, and parts bought for one.
--
-- Slice 1 reserved purchase_order.work_order_id and the work_order_part line kind for this
-- moment. Now:
--
--   * purchase_order.work_order_id points at a maintenance work order;
--   * a purchase line of kind work_order_part names the work order part it buys
--     (work_order_part_id), and only a planned part marked to_order, on the same work
--     order as the purchase order, can be put on one, once;
--   * receive_purchase_order lands what arrives on the work order: a work order part
--     takes the received quantity at the order's cost, and a non-stock line on an order
--     for a work order becomes a vendor cost on it. Stock lines still go into stock
--     through the ledger exactly as before; they reach the job when they are issued.
--
-- receive_purchase_order is replaced with the same signature and the same rules as
-- 20261022060000; the only additions are the two landings above, written with the
-- maintenance write flag open so the maintenance guards let them through. A cost lands
-- even when the work order has since been closed: the invoice is real whenever it
-- arrives, and the trail says when it landed.

alter table only "public"."purchase_order"
  drop constraint if exists "purchase_order_work_order_id_fkey";

alter table only "public"."purchase_order"
  add constraint "purchase_order_work_order_id_fkey" foreign key ("work_order_id") references "public"."maintenance_work_order"("id") on delete set null;

comment on column "public"."purchase_order"."work_order_id" is
  'The maintenance work order this purchase is for. Receiving a non-stock line lands its cost on that work order.';

create index if not exists "purchase_order_work_order_idx"
  on "public"."purchase_order" ("work_order_id") where "work_order_id" is not null;

alter table "public"."purchase_order_line"
  add column if not exists "work_order_part_id" uuid;

comment on column "public"."purchase_order_line"."work_order_part_id" is
  'For a work_order_part line: the work order part it buys. Receiving the line lands the part on its work order.';

-- Restrict: a part that is on an order stays, so the order still says what it was for.
alter table only "public"."purchase_order_line"
  drop constraint if exists "purchase_order_line_work_order_part_id_fkey";

alter table only "public"."purchase_order_line"
  add constraint "purchase_order_line_work_order_part_id_fkey" foreign key ("work_order_part_id") references "public"."maintenance_work_order_part"("id") on delete restrict;

alter table "public"."purchase_order_line"
  drop constraint if exists "purchase_order_line_work_order_part_check";

-- A work order part line always names its part, and only that kind of line does.
alter table "public"."purchase_order_line"
  add constraint "purchase_order_line_work_order_part_check" check (("kind" = 'work_order_part'::text) = ("work_order_part_id" is not null));

-- One order line per part.
create unique index if not exists "purchase_order_line_work_order_part_key"
  on "public"."purchase_order_line" ("work_order_part_id") where "work_order_part_id" is not null;

-- A part goes on an order only when it is still planned and marked to order, and only on
-- an order for its own work order. Runs beside guard_purchase_order_line_writes, which
-- already decides whether the order's lines are editable at all.
create or replace function "public"."guard_purchase_line_work_order_part"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  part public.maintenance_work_order_part%rowtype;
  order_work_order uuid;
begin
  if new.work_order_part_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.work_order_part_id is not distinct from old.work_order_part_id then
      return new;
    end if;
  end if;

  if public.purchase_write_open() or auth.uid() is null then
    return new;
  end if;

  select * into part
    from public.maintenance_work_order_part p
   where p.id = new.work_order_part_id
     and p.tenant_id = new.tenant_id;

  if not found then
    raise exception 'That work order part is not in this company.' using errcode = 'insufficient_privilege';
  end if;

  if part.status <> 'planned' or not part.to_order then
    raise exception 'Only a planned part marked to order can go on a purchase order.' using errcode = 'insufficient_privilege';
  end if;

  select o.work_order_id into order_work_order from public.purchase_order o where o.id = new.purchase_order_id;

  if order_work_order is distinct from part.work_order_id then
    raise exception 'Put the part on a purchase order for its own work order.' using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

alter function "public"."guard_purchase_line_work_order_part"() owner to "postgres";
revoke execute on function "public"."guard_purchase_line_work_order_part"() from public, "anon", "authenticated";

create or replace trigger "purchase_order_line_work_order_part_guard"
  before insert or update on "public"."purchase_order_line"
  for each row execute function "public"."guard_purchase_line_work_order_part"();

-- A purchase order can only be pointed at a work order in its own tenant.
create or replace function "public"."guard_purchase_order_work_order"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
begin
  if new.work_order_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.work_order_id is not distinct from old.work_order_id then
      return new;
    end if;
  end if;

  if not exists (
    select 1 from public.maintenance_work_order wo where wo.id = new.work_order_id and wo.tenant_id = new.tenant_id
  ) then
    raise exception 'That work order is not in this company.' using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

alter function "public"."guard_purchase_order_work_order"() owner to "postgres";
revoke execute on function "public"."guard_purchase_order_work_order"() from public, "anon", "authenticated";

create or replace trigger "purchase_order_work_order_guard"
  before insert or update on "public"."purchase_order"
  for each row execute function "public"."guard_purchase_order_work_order"();

-- --- Receiving lands costs on the work order ------------------------------------------

-- As in 20261022060000, plus the two landings on the work order. Same signature, so the
-- app's call does not change.
create or replace function "public"."receive_purchase_order"(
  "p_order_id" uuid,
  "p_lines" jsonb,
  "p_received_on" date default current_date,
  "p_packing_slip" text default null,
  "p_invoice_reference" text default null,
  "p_note" text default null
) returns uuid
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  po public.purchase_order%rowtype;
  po_line public.purchase_order_line%rowtype;
  actor uuid := auth.uid();
  actor_label text;
  entry jsonb;
  entry_qty numeric(14,3);
  entry_place uuid;
  place_kind text;
  new_receipt_id uuid;
  new_movement_id uuid;
  supplier_name text;
  received_any boolean := false;
  outstanding numeric;
  next_status text;
  new_receipt_line_id uuid;
  wo_part public.maintenance_work_order_part%rowtype;
  po_label text;
begin
  select * into po from public.purchase_order where id = p_order_id for update;

  if not found then
    raise exception 'That purchase order no longer exists.';
  end if;

  if actor is null or not authz.purchasing_can_act(po.tenant_id) then
    raise exception 'Only someone with admin panel access in this company can receive an order.'
      using errcode = 'insufficient_privilege';
  end if;

  if po.status not in ('ordered', 'partially_received') then
    raise exception 'Only an order that has been placed can be received.';
  end if;

  actor_label := authz.purchasing_actor_name();
  select s.name into supplier_name from public.supplier s where s.id = po.supplier_id;

  po_label := 'PO-' || lpad(po.number::text, 6, '0');

  perform set_config('app.purchase_write', 'on', true);
  perform set_config('app.maintenance_write', 'on', true);

  insert into public.purchase_receipt (
    tenant_id, purchase_order_id, received_on, received_by, packing_slip, invoice_reference, note
  ) values (
    po.tenant_id, po.id, coalesce(p_received_on, current_date), actor,
    nullif(btrim(coalesce(p_packing_slip, '')), ''),
    nullif(btrim(coalesce(p_invoice_reference, '')), ''),
    nullif(btrim(coalesce(p_note, '')), '')
  )
  returning id into new_receipt_id;

  for entry in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    entry_qty := nullif(entry->>'qty', '')::numeric;

    if entry_qty is null or entry_qty = 0 then
      continue;
    end if;

    if entry_qty < 0 then
      raise exception 'A received quantity cannot be negative.';
    end if;

    select * into po_line
      from public.purchase_order_line
     where id = (entry->>'line_id')::uuid
       and purchase_order_id = po.id
       for update;

    if not found then
      raise exception 'A line on this receipt is not on the order.';
    end if;

    if po_line.qty_received + entry_qty > po_line.qty_ordered then
      raise exception 'Line "%": % still to come, and % was entered. Put the extra on a line of its own.',
        po_line.description, po_line.qty_ordered - po_line.qty_received, entry_qty;
    end if;

    entry_place := null;
    new_movement_id := null;

    if po_line.kind = 'stock' then
      entry_place := nullif(entry->>'place_id', '')::uuid;

      if entry_place is null then
        raise exception 'Line "%": choose where the stock was put.', po_line.description;
      end if;

      select il.kind into place_kind
        from public.inventory_location il
       where il.id = entry_place
         and il.tenant_id = po.tenant_id
         and il.active;

      if place_kind is null then
        raise exception 'Line "%": that stocking place is not available.', po_line.description;
      end if;

      if place_kind in ('transit', 'loss') then
        raise exception 'Line "%": receive into a real place, not transit or write-off.', po_line.description;
      end if;

      insert into public.inventory_movement (
        tenant_id, item_id, qty, from_location_id, to_location_id, movement_type, note, created_by
      ) values (
        po.tenant_id, po_line.item_id, entry_qty, null, entry_place, 'receive',
        format('Received on PO-%s from %s', lpad(po.number::text, 6, '0'), coalesce(supplier_name, 'a supplier')),
        actor
      )
      returning id into new_movement_id;

      update public.inventory_item
         set unit_cost = po_line.unit_cost
       where id = po_line.item_id
         and tenant_id = po.tenant_id;

      if po.supplier_id is not null then
        update public.supplier_item
           set last_unit_cost = po_line.unit_cost
         where supplier_id = po.supplier_id
           and item_id = po_line.item_id
           and tenant_id = po.tenant_id;
      end if;
    end if;

    insert into public.purchase_receipt_line (
      tenant_id, receipt_id, purchase_order_line_id, qty, place_id, movement_id, unit_cost
    ) values (
      po.tenant_id, new_receipt_id, po_line.id, entry_qty, entry_place, new_movement_id, po_line.unit_cost
    )
    returning id into new_receipt_line_id;

    update public.purchase_order_line
       set qty_received = qty_received + entry_qty
     where id = po_line.id;

    -- A part bought for a work order lands on that work order: the part takes the
    -- received quantity at the order's cost and counts in the job's parts cost. It goes
    -- straight to the job, so no stock movement is posted for it.
    if po_line.kind = 'work_order_part' and po_line.work_order_part_id is not null then
      select * into wo_part
        from public.maintenance_work_order_part p
       where p.id = po_line.work_order_part_id
         and p.tenant_id = po.tenant_id
         for update;

      if found then
        update public.maintenance_work_order_part
           set status = 'received',
               to_order = false,
               qty = po_line.qty_received + entry_qty,
               unit_cost = po_line.unit_cost,
               line_total = round((po_line.qty_received + entry_qty) * po_line.unit_cost, 2),
               received_at = now()
         where id = wo_part.id;

        insert into public.maintenance_work_order_event (
          tenant_id, work_order_id, action, actor_user_id, actor_name, reason, created_at
        ) values (
          po.tenant_id, wo_part.work_order_id, 'cost_received', actor, actor_label,
          format('%s %s of %s received on %s', entry_qty::text, po_line.unit, po_line.description, po_label),
          clock_timestamp()
        );
      end if;
    end if;

    -- Anything else bought for a work order (outside work, materials) lands on it as a
    -- vendor cost, one row per receipt line, so the job's cost follows what arrived.
    if po_line.kind = 'non_stock' and po.work_order_id is not null then
      insert into public.maintenance_work_order_cost (
        tenant_id, work_order_id, kind, supplier_id, description, reference, amount, incurred_on,
        purchase_receipt_line_id, created_by
      ) values (
        po.tenant_id, po.work_order_id, 'vendor', po.supplier_id, po_line.description, po_label,
        round(entry_qty * po_line.unit_cost, 2), coalesce(p_received_on, current_date),
        new_receipt_line_id, actor
      );

      insert into public.maintenance_work_order_event (
        tenant_id, work_order_id, action, actor_user_id, actor_name, reason, created_at
      ) values (
        po.tenant_id, po.work_order_id, 'cost_received', actor, actor_label,
        format('%s %s of %s received on %s', entry_qty::text, po_line.unit, po_line.description, po_label),
        clock_timestamp()
      );
    end if;

    received_any := true;
  end loop;

  if not received_any then
    raise exception 'Enter a quantity on at least one line.';
  end if;

  select coalesce(sum(l.qty_ordered - l.qty_received), 0)
    into outstanding
    from public.purchase_order_line l
   where l.purchase_order_id = po.id;

  next_status := case when outstanding <= 0 then 'received' else 'partially_received' end;

  update public.purchase_order
     set status = next_status,
         received_at = case when next_status = 'received' then now() else received_at end
   where id = po.id;

  insert into public.purchase_order_event (tenant_id, purchase_order_id, action, actor_user_id, actor_name, reason, created_at)
  values (
    po.tenant_id, po.id, 'received', actor, actor_label,
    case when next_status = 'received' then 'Everything on the order has arrived.'
         else 'Part of the order arrived. The rest is backordered.' end,
    clock_timestamp()
  );

  perform set_config('app.maintenance_write', 'off', true);
  perform set_config('app.purchase_write', 'off', true);

  return new_receipt_id;
end;
$$;

alter function "public"."receive_purchase_order"(uuid, jsonb, date, text, text, text) owner to "postgres";

revoke execute on function "public"."receive_purchase_order"(uuid, jsonb, date, text, text, text) from public, "anon";
grant execute on function "public"."receive_purchase_order"(uuid, jsonb, date, text, text, text) to "authenticated", "service_role";
