-- Purchasing module: receiving.
--
-- A receipt records what turned up against an order: when, who took it in, the packing
-- slip and invoice reference, and per line how many arrived and where they were put.
--
-- Stock never changes here directly. A stock line posts an ordinary "receive" movement
-- into the inventory ledger, and the ledger's own trigger (apply_inventory_movement) moves
-- the balance, exactly as a receipt typed in on the Stock screen would. A receive
-- movement has no origin inside the company: that is the ledger's existing rule for
-- stock arriving from a purchase, and it is why a supplier needs no stocking place of its
-- own. Each receipt line keeps the id of the movement it posted, so the stock history and
-- the order point at each other.
--
-- Receipts are append-only, like the ledger they feed. A wrong receipt is not edited
-- away; it is corrected by a reversing movement and a note, so the history still
-- explains itself.

create table if not exists "public"."purchase_receipt" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "purchase_order_id" uuid not null,
  "received_on" date default current_date not null,
  "received_by" uuid,
  "packing_slip" text,
  "invoice_reference" text,
  "note" text,
  "created_at" timestamp with time zone default "now"() not null
);

alter table "public"."purchase_receipt" owner to "postgres";

comment on table "public"."purchase_receipt" is
  'One delivery against a purchase order. Append-only. The invoice reference is kept for the finance system; matching the invoice happens there.';

create table if not exists "public"."purchase_receipt_line" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "receipt_id" uuid not null,
  "purchase_order_line_id" uuid not null,
  "qty" numeric(14,3) not null,

  -- Set for a stock line: the stocking place it went into, and the ledger movement that
  -- put it there.
  "place_id" uuid,
  "movement_id" uuid,

  -- The line's cost at the moment it was received, which is the cost the item takes on.
  "unit_cost" numeric(14,4) not null,
  "created_at" timestamp with time zone default "now"() not null,

  constraint "purchase_receipt_line_qty_check" check ("qty" > 0),
  constraint "purchase_receipt_line_place_movement_check" check (("place_id" is null) = ("movement_id" is null))
);

alter table "public"."purchase_receipt_line" owner to "postgres";

comment on table "public"."purchase_receipt_line" is
  'How many of one order line arrived on a receipt, and for stock, where it went and the ledger movement that put it there.';

alter table only "public"."purchase_receipt"
  add constraint "purchase_receipt_pkey" primary key ("id");

alter table only "public"."purchase_receipt_line"
  add constraint "purchase_receipt_line_pkey" primary key ("id");

alter table only "public"."purchase_receipt"
  add constraint "purchase_receipt_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."purchase_receipt"
  add constraint "purchase_receipt_purchase_order_id_fkey" foreign key ("purchase_order_id") references "public"."purchase_order"("id") on delete restrict;

alter table only "public"."purchase_receipt"
  add constraint "purchase_receipt_received_by_fkey" foreign key ("received_by") references "public"."users"("id") on delete set null;

alter table only "public"."purchase_receipt_line"
  add constraint "purchase_receipt_line_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."purchase_receipt_line"
  add constraint "purchase_receipt_line_receipt_id_fkey" foreign key ("receipt_id") references "public"."purchase_receipt"("id") on delete cascade;

-- Restrict: an order line that something was received against cannot be deleted.
alter table only "public"."purchase_receipt_line"
  add constraint "purchase_receipt_line_purchase_order_line_id_fkey" foreign key ("purchase_order_line_id") references "public"."purchase_order_line"("id") on delete restrict;

alter table only "public"."purchase_receipt_line"
  add constraint "purchase_receipt_line_place_id_fkey" foreign key ("place_id") references "public"."inventory_location"("id") on delete restrict;

alter table only "public"."purchase_receipt_line"
  add constraint "purchase_receipt_line_movement_id_fkey" foreign key ("movement_id") references "public"."inventory_movement"("id") on delete restrict;

create index if not exists "purchase_receipt_order_idx"
  on "public"."purchase_receipt" ("purchase_order_id", "created_at");

create index if not exists "purchase_receipt_line_receipt_idx"
  on "public"."purchase_receipt_line" ("receipt_id");

create index if not exists "purchase_receipt_line_order_line_idx"
  on "public"."purchase_receipt_line" ("purchase_order_line_id");

alter table "public"."purchase_receipt" enable row level security;
alter table "public"."purchase_receipt_line" enable row level security;

create policy "purchase_receipt_tenant_select" on "public"."purchase_receipt"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_receipt_tenant_insert" on "public"."purchase_receipt"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_receipt_line_tenant_select" on "public"."purchase_receipt_line"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_receipt_line_tenant_insert" on "public"."purchase_receipt_line"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- No update or delete policy on receipts, on purpose, matching the ledger they feed.

grant select, insert on table "public"."purchase_receipt" to "authenticated";
revoke update, delete on table "public"."purchase_receipt" from "authenticated";
grant select, insert, update, delete on table "public"."purchase_receipt" to "service_role";
grant select, insert on table "public"."purchase_receipt_line" to "authenticated";
revoke update, delete on table "public"."purchase_receipt_line" from "authenticated";
grant select, insert, update, delete on table "public"."purchase_receipt_line" to "service_role";

-- Receive against an order, all in one transaction.
--
-- The receipt, its lines, every ledger movement, the received quantities and the order's
-- new status either all land or none do. The order row is locked first, so two people
-- receiving the same delivery at once are serialized and the second sees what the first
-- took in. Over-receipt is refused here as well as in the app and in the line's check
-- constraint, because this is the only place that sees the quantity under the lock.
--
-- p_lines is a JSON array of { "line_id": uuid, "qty": number, "place_id": uuid }. A line
-- left out or given zero is simply not on this receipt. place_id is required for stock.
--
-- Security invoker: row level security decides whose orders can be received, and the
-- movement insert passes through the ledger's own policies and trigger.
create or replace function "public"."receive_purchase_order"(
  "p_order_id" uuid,
  "p_lines" jsonb,
  "p_received_on" date default current_date,
  "p_packing_slip" text default null,
  "p_invoice_reference" text default null,
  "p_note" text default null,
  "p_actor_user_id" uuid default null,
  "p_actor_name" text default null
) returns uuid
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  po public.purchase_order%rowtype;
  po_line public.purchase_order_line%rowtype;
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
begin
  select * into po from public.purchase_order where id = p_order_id for update;

  if not found then
    raise exception 'That purchase order no longer exists.';
  end if;

  if po.status not in ('ordered', 'partially_received') then
    raise exception 'Only an order that has been placed can be received.';
  end if;

  select s.name into supplier_name from public.supplier s where s.id = po.supplier_id;

  insert into public.purchase_receipt (
    tenant_id, purchase_order_id, received_on, received_by, packing_slip, invoice_reference, note
  ) values (
    po.tenant_id, po.id, coalesce(p_received_on, current_date), p_actor_user_id,
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
        p_actor_user_id
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
    );

    update public.purchase_order_line
       set qty_received = qty_received + entry_qty
     where id = po_line.id;

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

  insert into public.purchase_order_event (tenant_id, purchase_order_id, action, actor_user_id, actor_name, reason)
  values (
    po.tenant_id, po.id, 'received', p_actor_user_id, p_actor_name,
    case when next_status = 'received' then 'Everything on the order has arrived.'
         else 'Part of the order arrived. The rest is backordered.' end
  );

  return new_receipt_id;
end;
$$;

alter function "public"."receive_purchase_order"(uuid, jsonb, date, text, text, text, uuid, text) owner to "postgres";

revoke execute on function "public"."receive_purchase_order"(uuid, jsonb, date, text, text, text, uuid, text) from "public", "anon";
grant execute on function "public"."receive_purchase_order"(uuid, jsonb, date, text, text, text, uuid, text) to "authenticated", "service_role";
