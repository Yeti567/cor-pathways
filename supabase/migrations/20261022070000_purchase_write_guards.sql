-- Purchasing: refuse direct writes that would skip the approval and receiving rules.
--
-- Row level security answers "is this your tenant", not "is this move allowed", and the
-- purchasing tables keep the tenant-wide update policy every module uses. Without these
-- triggers a member could PATCH an order to approved, rewrite a locked cost, or insert
-- an approval into the trail under somebody else's name, all through the API.
--
-- The pattern: transition_purchase_order and receive_purchase_order (20261022060000) set
-- the transaction-local setting app.purchase_write to 'on' around their own writes and
-- back to 'off' before returning. Each trigger lets a write through when that setting is
-- on. Otherwise it applies the rule for a direct write by a person:
--
--   purchase_order        status, its timestamps, the requester and the number never
--                         change directly; other fields only while the order is
--                         editable (draft, rejected, or pending to its current
--                         approver); the subtotal must be the sum of the lines; an
--                         order is never deleted, it is cancelled.
--   purchase_order_line   only while the order is editable; received quantities change
--                         only by receiving; the line total is quantity times cost.
--   purchase_order_event  only "created" and "exported" can be written directly, and the
--                         actor is always taken from the session, never from the row.
--   purchase_receipt(_line)  never written directly.
--   purchase_approval_rule, purchase_settings  admins only.
--
-- A write with no signed-in user (auth.uid() is null) is the service role or a migration
-- and is let through: these guards are about people, and the service role already holds
-- every privilege.

create or replace function "public"."purchase_write_open"() returns boolean
    language "sql" stable
    set "search_path" to 'pg_temp'
    as $$
  select coalesce(current_setting('app.purchase_write', true), '') = 'on';
$$;

alter function "public"."purchase_write_open"() owner to "postgres";
revoke execute on function "public"."purchase_write_open"() from public, "anon";
grant execute on function "public"."purchase_write_open"() to "authenticated", "service_role";

-- Editable for this person right now: draft or rejected, or waiting for approval and they
-- are the approver it waits on.
create or replace function "public"."purchase_order_editable_by_me"("p_order_id" uuid) returns boolean
    language "plpgsql" stable security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  order_status text;
begin
  select o.status into order_status from public.purchase_order o where o.id = p_order_id;

  if order_status in ('draft', 'rejected') then
    return true;
  end if;

  if order_status = 'pending_approval' then
    return coalesce((select c.allowed from authz.purchase_order_approval_check(p_order_id) c), false);
  end if;

  return false;
end;
$$;

alter function "public"."purchase_order_editable_by_me"(uuid) owner to "postgres";
revoke execute on function "public"."purchase_order_editable_by_me"(uuid) from public, "anon";
grant execute on function "public"."purchase_order_editable_by_me"(uuid) to "authenticated", "service_role";

-- --- purchase_order -------------------------------------------------------------

create or replace function "public"."guard_purchase_order_writes"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  line_sum numeric;
begin
  if public.purchase_write_open() or auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'A purchase order is cancelled, not deleted, so its trail survives.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft'
       or new.submitted_at is not null or new.approved_at is not null or new.rejected_at is not null
       or new.ordered_at is not null or new.received_at is not null or new.closed_at is not null
       or new.cancelled_at is not null or new.exported_at is not null then
      raise exception 'A new purchase order starts as a draft.' using errcode = 'insufficient_privilege';
    end if;

    if new.requester_id is distinct from auth.uid() then
      raise exception 'The requester of a new order is whoever raises it.' using errcode = 'insufficient_privilege';
    end if;

    if new.subtotal <> 0 then
      raise exception 'A new order has no lines yet, so its subtotal is zero.' using errcode = 'check_violation';
    end if;

    return new;
  end if;

  -- UPDATE. Status and approval only ever move through transition_purchase_order.
  if (new.status, new.submitted_at, new.approved_at, new.rejected_at, new.ordered_at, new.received_at,
      new.closed_at, new.cancelled_at, new.requester_id, new.created_by, new.number, new.tenant_id)
     is distinct from
     (old.status, old.submitted_at, old.approved_at, old.rejected_at, old.ordered_at, old.received_at,
      old.closed_at, old.cancelled_at, old.requester_id, old.created_by, old.number, old.tenant_id) then
    raise exception 'A purchase order''s status and approvals change only through its approval steps.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Everything a person edits. exported_at is left out on purpose: the finance export
  -- stamps placed orders, and the stamp changes nothing that was approved.
  if (new.title, new.supplier_id, new.location_id, new.account_code, new.work_order_id, new.needed_by,
      new.ship_to_location_id, new.notes, new.emergency, new.discount, new.shipping, new.tax, new.subtotal, new.total)
     is distinct from
     (old.title, old.supplier_id, old.location_id, old.account_code, old.work_order_id, old.needed_by,
      old.ship_to_location_id, old.notes, old.emergency, old.discount, old.shipping, old.tax, old.subtotal, old.total) then
    if not public.purchase_order_editable_by_me(old.id) then
      raise exception 'This order can no longer be edited.' using errcode = 'insufficient_privilege';
    end if;

    if new.subtotal is distinct from old.subtotal then
      select coalesce(sum(l.line_total), 0) into line_sum
        from public.purchase_order_line l
       where l.purchase_order_id = new.id;

      if abs(new.subtotal - line_sum) > 0.005 then
        raise exception 'The subtotal has to be the sum of the lines.' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- --- purchase_order_line ----------------------------------------------------------

create or replace function "public"."guard_purchase_order_line_writes"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  target_order uuid;
begin
  if public.purchase_write_open() or auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    target_order := old.purchase_order_id;
  else
    target_order := new.purchase_order_id;
  end if;

  if tg_op = 'UPDATE'
     and (new.purchase_order_id is distinct from old.purchase_order_id or new.tenant_id is distinct from old.tenant_id) then
    raise exception 'A line stays on its own order.' using errcode = 'insufficient_privilege';
  end if;

  if not public.purchase_order_editable_by_me(target_order) then
    raise exception 'Lines are locked at this stage of the order.' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if old.qty_received > 0 then
      raise exception 'Stock has been received against this line, so it cannot be removed.'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if (tg_op = 'INSERT' and new.qty_received <> 0)
     or (tg_op = 'UPDATE' and new.qty_received is distinct from old.qty_received) then
    raise exception 'Received quantities change only by receiving against the order.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Costs lock once anything is received. Editable statuses never have receipts today;
  -- this holds even if that ever changes.
  if tg_op = 'UPDATE' and old.qty_received > 0
     and (new.qty_ordered, new.unit_cost, new.item_id, new.kind) is distinct from
         (old.qty_ordered, old.unit_cost, old.item_id, old.kind) then
    raise exception 'Stock has been received against this line, so its quantity and cost are locked.'
      using errcode = 'insufficient_privilege';
  end if;

  if abs(new.line_total - round(new.qty_ordered * new.unit_cost, 2)) > 0.01 then
    raise exception 'A line total is its quantity times its unit cost.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- --- purchase_order_event -----------------------------------------------------------

create or replace function "public"."guard_purchase_order_event_writes"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  order_status text;
  order_exported_at timestamp with time zone;
begin
  if public.purchase_write_open() or auth.uid() is null then
    return new;
  end if;

  if new.action not in ('created', 'exported') then
    raise exception 'The trail records approvals and status changes itself. They cannot be written directly.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The actor is whoever is signed in, whatever the row claims.
  new.actor_user_id := auth.uid();
  new.actor_name := authz.purchasing_actor_name();
  new.rule_id := null;
  new.level := null;
  new.emergency := false;
  new.created_at := now();

  select o.status, o.exported_at into order_status, order_exported_at
    from public.purchase_order o
   where o.id = new.purchase_order_id;

  if order_status is null then
    raise exception 'That purchase order no longer exists.';
  end if;

  if new.action = 'created'
     and (order_status <> 'draft'
          or exists (select 1 from public.purchase_order_event e where e.purchase_order_id = new.purchase_order_id)) then
    raise exception 'An order is created once.' using errcode = 'insufficient_privilege';
  end if;

  if new.action = 'exported' and order_exported_at is null then
    raise exception 'Only an exported order can be marked as exported.' using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- --- receipts -------------------------------------------------------------------------

create or replace function "public"."guard_purchase_receipt_writes"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
begin
  if public.purchase_write_open() or auth.uid() is null then
    return new;
  end if;

  raise exception 'Receipts are recorded by receiving against the order.' using errcode = 'insufficient_privilege';
end;
$$;

-- --- rules and settings ----------------------------------------------------------------

-- Whoever edits the rules decides who approves, so only an admin may. Otherwise any
-- member could add themselves as an approver.
create or replace function "public"."guard_purchase_rule_writes"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  target_tenant uuid;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    target_tenant := old.tenant_id;
  else
    target_tenant := new.tenant_id;
  end if;

  if not authz.purchasing_is_admin(target_tenant)
     or (tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id) then
    raise exception 'Only an admin can change purchasing approval rules and settings.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function "public"."guard_purchase_order_writes"() owner to "postgres";
alter function "public"."guard_purchase_order_line_writes"() owner to "postgres";
alter function "public"."guard_purchase_order_event_writes"() owner to "postgres";
alter function "public"."guard_purchase_receipt_writes"() owner to "postgres";
alter function "public"."guard_purchase_rule_writes"() owner to "postgres";

-- Trigger functions have no business on the public API. Revoking EXECUTE does not stop
-- a trigger, which runs whoever holds the privilege.
revoke execute on function "public"."guard_purchase_order_writes"() from public, "anon", "authenticated";
revoke execute on function "public"."guard_purchase_order_line_writes"() from public, "anon", "authenticated";
revoke execute on function "public"."guard_purchase_order_event_writes"() from public, "anon", "authenticated";
revoke execute on function "public"."guard_purchase_receipt_writes"() from public, "anon", "authenticated";
revoke execute on function "public"."guard_purchase_rule_writes"() from public, "anon", "authenticated";

create or replace trigger "purchase_order_guard_writes"
  before insert or update or delete on "public"."purchase_order"
  for each row execute function "public"."guard_purchase_order_writes"();

create or replace trigger "purchase_order_line_guard_writes"
  before insert or update or delete on "public"."purchase_order_line"
  for each row execute function "public"."guard_purchase_order_line_writes"();

create or replace trigger "purchase_order_event_guard_writes"
  before insert on "public"."purchase_order_event"
  for each row execute function "public"."guard_purchase_order_event_writes"();

create or replace trigger "purchase_receipt_guard_writes"
  before insert on "public"."purchase_receipt"
  for each row execute function "public"."guard_purchase_receipt_writes"();

create or replace trigger "purchase_receipt_line_guard_writes"
  before insert on "public"."purchase_receipt_line"
  for each row execute function "public"."guard_purchase_receipt_writes"();

create or replace trigger "purchase_approval_rule_guard_writes"
  before insert or update or delete on "public"."purchase_approval_rule"
  for each row execute function "public"."guard_purchase_rule_writes"();

create or replace trigger "purchase_settings_guard_writes"
  before insert or update or delete on "public"."purchase_settings"
  for each row execute function "public"."guard_purchase_rule_writes"();
