-- Maintenance: refuse direct writes that would skip the work order rules.
--
-- Row level security answers "is this your tenant", not "is this move allowed", and the
-- maintenance tables keep the tenant-wide policies every module uses. Without these
-- triggers a member could PATCH a work order to closed, rewrite a locked cost, issue a
-- part without the ledger, or forge the trail, all through the API.
--
-- The functions in 20261022110000 and 20261022130000 set the transaction-local setting
-- app.maintenance_write to 'on' around their own writes. Each trigger here lets a write
-- through when that setting is on. Otherwise it applies the rule for a direct write by a
-- person:
--
--   maintenance_work_order         a new one starts as requested, raised by whoever is
--                                  signed in, from a manual source; status, its
--                                  timestamps, completion, the source links, the history
--                                  links and the cost roll-up never change directly; the
--                                  details change only by a manager, only before the
--                                  work is completed; a work order is never deleted.
--   maintenance_work_order_labour  a manager, or the assignee logging their own time;
--                                  locked once the work order is closed or cancelled.
--   maintenance_work_order_part    a manager or the assignee, planned parts only; issuing,
--                                  returning and receiving change a part only through
--                                  the functions; locked once closed or cancelled.
--   maintenance_work_order_cost    a manager only; a cost landed by a purchase receipt
--                                  never changes; locked once closed or cancelled.
--   maintenance_work_order_task    a manager, or the assignee ticking rows; who ticked a
--                                  row is taken from the session.
--   maintenance_work_order_note    insert only, author taken from the session.
--   maintenance_work_order_event   never written directly.
--
-- A write with no signed-in user (auth.uid() is null) is the service role or a migration
-- and is let through: these guards are about people, and the service role already holds
-- every privilege.

-- Whether a work order still takes cost changes: anything short of closed or cancelled.
create or replace function "public"."maintenance_costs_open"("p_work_order_id" uuid) returns boolean
    language "sql" stable security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
  select coalesce((
    select wo.status not in ('closed', 'cancelled')
      from public.maintenance_work_order wo
     where wo.id = p_work_order_id
  ), false);
$$;

-- Whether the signed-in user is the person a work order is assigned to.
create or replace function "public"."maintenance_is_assignee"("p_work_order_id" uuid) returns boolean
    language "sql" stable security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
  select coalesce((
    select wo.assignee_id = auth.uid()
      from public.maintenance_work_order wo
     where wo.id = p_work_order_id
  ), false);
$$;

alter function "public"."maintenance_costs_open"(uuid) owner to "postgres";
alter function "public"."maintenance_is_assignee"(uuid) owner to "postgres";
revoke execute on function "public"."maintenance_costs_open"(uuid) from public, "anon";
revoke execute on function "public"."maintenance_is_assignee"(uuid) from public, "anon";
grant execute on function "public"."maintenance_costs_open"(uuid) to "authenticated", "service_role";
grant execute on function "public"."maintenance_is_assignee"(uuid) to "authenticated", "service_role";

-- --- maintenance_work_order ---------------------------------------------------------

create or replace function "public"."guard_maintenance_work_order_writes"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  assignee_changed boolean;
begin
  if public.maintenance_write_open() or auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'A work order is cancelled, not deleted, so its history survives.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The asset and the place must be this tenant's own. A foreign key is checked without
  -- row level security, so an id typed into a request could otherwise point anywhere.
  if new.equipment_id is not null
     and not exists (select 1 from public.equipment e where e.id = new.equipment_id and e.tenant_id = new.tenant_id) then
    raise exception 'That asset is not in this company.' using errcode = 'insufficient_privilege';
  end if;

  if new.location_id is not null
     and not exists (select 1 from public.locations l where l.id = new.location_id and l.tenant_id = new.tenant_id) then
    raise exception 'That location is not in this company.' using errcode = 'insufficient_privilege';
  end if;

  if new.assignee_id is not null then
    if tg_op = 'INSERT' then
      assignee_changed := true;
    else
      assignee_changed := new.assignee_id is distinct from old.assignee_id;
    end if;

    if assignee_changed and not exists (
      select 1 from public.users u where u.id = new.assignee_id and u.tenant_id = new.tenant_id and u.active
    ) then
      raise exception 'That person is not an active member of this company.' using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if not public.maintenance_module_on(new.tenant_id) then
      raise exception 'The maintenance module is switched off for this company.' using errcode = 'insufficient_privilege';
    end if;

    if new.status <> 'requested'
       or new.approved_at is not null or new.assigned_at is not null or new.started_at is not null
       or new.completed_at is not null or new.completed_by is not null or new.closed_at is not null
       or new.closed_by is not null or new.cancelled_at is not null
       or new.completion_notes is not null or new.meter_at_completion is not null then
      raise exception 'A new work order starts as requested.' using errcode = 'insufficient_privilege';
    end if;

    if new.source <> 'manual' or new.source_id is not null or new.follow_up_id is not null
       or new.scheduled_service_id is not null or new.submission_id is not null or new.form_item_id is not null then
      raise exception 'Work orders from a corrective action, a scheduled service or an inspection are raised by the app, not typed in.'
        using errcode = 'insufficient_privilege';
    end if;

    if new.maintenance_log_id is not null or new.meter_log_id is not null then
      raise exception 'A new work order has no history yet.' using errcode = 'insufficient_privilege';
    end if;

    if (new.labour_cost, new.parts_cost, new.vendor_cost, new.other_cost, new.total_cost) <> (0, 0, 0, 0, 0) then
      raise exception 'A new work order has no costs yet. They add up from its labour, parts and costs.'
        using errcode = 'insufficient_privilege';
    end if;

    if new.requester_id is distinct from auth.uid() then
      raise exception 'The requester of a new work order is whoever raises it.' using errcode = 'insufficient_privilege';
    end if;

    return new;
  end if;

  -- UPDATE. Status, completion, the source and history links, and the cost roll-up only
  -- ever change through the functions.
  if (new.status, new.approved_at, new.assigned_at, new.started_at, new.completed_at, new.completed_by,
      new.closed_at, new.closed_by, new.cancelled_at, new.completion_notes, new.meter_at_completion,
      new.number, new.tenant_id, new.requester_id, new.created_by,
      new.source, new.source_id, new.follow_up_id, new.scheduled_service_id, new.submission_id, new.form_item_id,
      new.maintenance_log_id, new.meter_log_id,
      new.labour_cost, new.parts_cost, new.vendor_cost, new.other_cost, new.total_cost)
     is distinct from
     (old.status, old.approved_at, old.assigned_at, old.started_at, old.completed_at, old.completed_by,
      old.closed_at, old.closed_by, old.cancelled_at, old.completion_notes, old.meter_at_completion,
      old.number, old.tenant_id, old.requester_id, old.created_by,
      old.source, old.source_id, old.follow_up_id, old.scheduled_service_id, old.submission_id, old.form_item_id,
      old.maintenance_log_id, old.meter_log_id,
      old.labour_cost, old.parts_cost, old.vendor_cost, old.other_cost, old.total_cost) then
    raise exception 'A work order''s status, completion and costs change only through its own steps.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Everything a person edits: the details, who it is for, and when.
  if (new.title, new.description, new.equipment_id, new.location_id, new.type, new.priority,
      new.assignee_id, new.scheduled_start, new.due_date)
     is distinct from
     (old.title, old.description, old.equipment_id, old.location_id, old.type, old.priority,
      old.assignee_id, old.scheduled_start, old.due_date) then
    if not authz.maintenance_can_manage(old.tenant_id) then
      raise exception 'Only someone with admin panel access can change a work order''s details.'
        using errcode = 'insufficient_privilege';
    end if;

    if old.status in ('completed', 'closed', 'cancelled') then
      raise exception 'This work order is % so its details are settled.', old.status
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

-- --- labour -------------------------------------------------------------------------

create or replace function "public"."guard_maintenance_labour_writes"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  target_order uuid;
  target_tenant uuid;
  is_manager boolean;
begin
  if public.maintenance_write_open() or auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    target_order := old.work_order_id;
    target_tenant := old.tenant_id;
  else
    target_order := new.work_order_id;
    target_tenant := new.tenant_id;
  end if;

  if tg_op = 'UPDATE'
     and (new.work_order_id is distinct from old.work_order_id or new.tenant_id is distinct from old.tenant_id) then
    raise exception 'Time stays on its own work order.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.maintenance_work_order wo where wo.id = target_order and wo.tenant_id = target_tenant) then
    raise exception 'That work order is not in this company.' using errcode = 'insufficient_privilege';
  end if;

  if not public.maintenance_costs_open(target_order) then
    raise exception 'This work order is closed, so its costs are locked.' using errcode = 'insufficient_privilege';
  end if;

  is_manager := authz.maintenance_can_manage(target_tenant);

  if tg_op = 'INSERT' then
    if not is_manager
       and not (public.maintenance_is_assignee(target_order) and new.worker_id = auth.uid()) then
      raise exception 'Log your own time on a work order assigned to you. A manager records anyone else''s.'
        using errcode = 'insufficient_privilege';
    end if;

    if new.worker_id is not null
       and not exists (select 1 from public.users u where u.id = new.worker_id and u.tenant_id = new.tenant_id) then
      raise exception 'That person is not in this company.' using errcode = 'insufficient_privilege';
    end if;

    new.created_by := auth.uid();
    return new;
  end if;

  if not is_manager then
    raise exception 'Only someone with admin panel access can change or remove logged time.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.created_by is distinct from old.created_by or new.client_uuid is distinct from old.client_uuid then
    raise exception 'Who logged the time does not change.' using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- --- parts --------------------------------------------------------------------------

create or replace function "public"."guard_maintenance_part_writes"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  target_order uuid;
  target_tenant uuid;
begin
  if public.maintenance_write_open() or auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    target_order := old.work_order_id;
    target_tenant := old.tenant_id;
  else
    target_order := new.work_order_id;
    target_tenant := new.tenant_id;
  end if;

  if tg_op = 'UPDATE'
     and (new.work_order_id is distinct from old.work_order_id or new.tenant_id is distinct from old.tenant_id) then
    raise exception 'A part stays on its own work order.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.maintenance_work_order wo where wo.id = target_order and wo.tenant_id = target_tenant) then
    raise exception 'That work order is not in this company.' using errcode = 'insufficient_privilege';
  end if;

  if not public.maintenance_costs_open(target_order) then
    raise exception 'This work order is closed, so its costs are locked.' using errcode = 'insufficient_privilege';
  end if;

  if not (authz.maintenance_can_manage(target_tenant) or public.maintenance_is_assignee(target_order)) then
    raise exception 'Only the person it is assigned to, or a manager, can change the parts on this work order.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'planned' then
      raise exception 'A part that was used, returned or received stays on the work order, so the stock history explains itself.'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  -- Issuing, returning and receiving are postings, not edits.
  if tg_op = 'INSERT' then
    if new.status <> 'planned' or new.movement_id is not null or new.return_movement_id is not null
       or new.place_id is not null or new.issued_at is not null or new.issued_by is not null
       or new.returned_at is not null or new.received_at is not null then
      raise exception 'A new part starts as planned. Issue it to post it.' using errcode = 'insufficient_privilege';
    end if;
  elsif (new.status, new.movement_id, new.return_movement_id, new.place_id, new.issued_at, new.issued_by,
         new.returned_at, new.received_at)
        is distinct from
        (old.status, old.movement_id, old.return_movement_id, old.place_id, old.issued_at, old.issued_by,
         old.returned_at, old.received_at) then
    raise exception 'Parts are issued, returned and received through their own steps.'
      using errcode = 'insufficient_privilege';
  elsif old.status <> 'planned'
        and (new.item_id, new.description, new.unit, new.qty, new.unit_cost, new.line_total, new.to_order)
            is distinct from
            (old.item_id, old.description, old.unit, old.qty, old.unit_cost, old.line_total, old.to_order) then
    raise exception 'This part has been posted, so its quantity and cost are locked.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.item_id is not null
     and not exists (select 1 from public.inventory_item i where i.id = new.item_id and i.tenant_id = new.tenant_id) then
    raise exception 'That item is not in this company.' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;

  return new;
end;
$$;

-- --- outside and other costs ----------------------------------------------------------

create or replace function "public"."guard_maintenance_cost_writes"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  target_order uuid;
  target_tenant uuid;
begin
  if public.maintenance_write_open() or auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    target_order := old.work_order_id;
    target_tenant := old.tenant_id;
  else
    target_order := new.work_order_id;
    target_tenant := new.tenant_id;
  end if;

  if tg_op = 'UPDATE'
     and (new.work_order_id is distinct from old.work_order_id or new.tenant_id is distinct from old.tenant_id) then
    raise exception 'A cost stays on its own work order.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.maintenance_work_order wo where wo.id = target_order and wo.tenant_id = target_tenant) then
    raise exception 'That work order is not in this company.' using errcode = 'insufficient_privilege';
  end if;

  if not public.maintenance_costs_open(target_order) then
    raise exception 'This work order is closed, so its costs are locked.' using errcode = 'insufficient_privilege';
  end if;

  if not authz.maintenance_can_manage(target_tenant) then
    raise exception 'Only someone with admin panel access can record outside costs.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if old.purchase_receipt_line_id is not null then
      raise exception 'This cost came from receiving a purchase order, so it stays.' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' and new.purchase_receipt_line_id is not null then
    raise exception 'Purchase order costs land by receiving the order.' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' and old.purchase_receipt_line_id is not null then
    raise exception 'This cost came from receiving a purchase order, so it stays as received.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' and new.purchase_receipt_line_id is distinct from old.purchase_receipt_line_id then
    raise exception 'Purchase order costs land by receiving the order.' using errcode = 'insufficient_privilege';
  end if;

  if new.supplier_id is not null
     and not exists (select 1 from public.supplier s where s.id = new.supplier_id and s.tenant_id = new.tenant_id) then
    raise exception 'That supplier is not in this company.' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;

  return new;
end;
$$;

-- --- tasks ----------------------------------------------------------------------------

create or replace function "public"."guard_maintenance_task_writes"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  target_order uuid;
  target_tenant uuid;
  is_manager boolean;
begin
  if public.maintenance_write_open() or auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    target_order := old.work_order_id;
    target_tenant := old.tenant_id;
  else
    target_order := new.work_order_id;
    target_tenant := new.tenant_id;
  end if;

  if tg_op = 'UPDATE'
     and (new.work_order_id is distinct from old.work_order_id or new.tenant_id is distinct from old.tenant_id) then
    raise exception 'A task stays on its own work order.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.maintenance_work_order wo where wo.id = target_order and wo.tenant_id = target_tenant) then
    raise exception 'That work order is not in this company.' using errcode = 'insufficient_privilege';
  end if;

  if not public.maintenance_costs_open(target_order) then
    raise exception 'This work order is closed, so its checklist is settled.' using errcode = 'insufficient_privilege';
  end if;

  is_manager := authz.maintenance_can_manage(target_tenant);

  -- The assignee ticks rows; adding, renaming and removing them is a manager's job.
  if not is_manager then
    if tg_op <> 'UPDATE' or not public.maintenance_is_assignee(target_order) then
      raise exception 'Only someone with admin panel access can change the checklist. The assignee ticks it.'
        using errcode = 'insufficient_privilege';
    end if;

    if (new.title, new.position) is distinct from (old.title, old.position) then
      raise exception 'Only someone with admin panel access can change the checklist. The assignee ticks it.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- Who ticked a row, and when, comes from the session, never from the request.
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.done then
      new.done_by := auth.uid();
      new.done_at := now();
    else
      new.done_by := null;
      new.done_at := null;
    end if;
  elsif new.done is distinct from old.done then
    if new.done then
      new.done_by := auth.uid();
      new.done_at := now();
    else
      new.done_by := null;
      new.done_at := null;
    end if;
  else
    new.done_by := old.done_by;
    new.done_at := old.done_at;
  end if;

  return new;
end;
$$;

-- --- notes ----------------------------------------------------------------------------

create or replace function "public"."guard_maintenance_note_writes"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
begin
  if public.maintenance_write_open() or auth.uid() is null then
    return new;
  end if;

  if not exists (
    select 1 from public.maintenance_work_order wo where wo.id = new.work_order_id and wo.tenant_id = new.tenant_id
  ) then
    raise exception 'That work order is not in this company.' using errcode = 'insufficient_privilege';
  end if;

  -- The author is whoever is signed in, whatever the row claims.
  new.author_id := auth.uid();
  new.author_name := authz.maintenance_actor_name();
  new.created_at := now();

  return new;
end;
$$;

-- --- the trail ------------------------------------------------------------------------

create or replace function "public"."guard_maintenance_event_writes"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
begin
  if public.maintenance_write_open() or auth.uid() is null then
    return new;
  end if;

  raise exception 'The work order trail records itself. It cannot be written directly.'
    using errcode = 'insufficient_privilege';
end;
$$;

alter function "public"."guard_maintenance_work_order_writes"() owner to "postgres";
alter function "public"."guard_maintenance_labour_writes"() owner to "postgres";
alter function "public"."guard_maintenance_part_writes"() owner to "postgres";
alter function "public"."guard_maintenance_cost_writes"() owner to "postgres";
alter function "public"."guard_maintenance_task_writes"() owner to "postgres";
alter function "public"."guard_maintenance_note_writes"() owner to "postgres";
alter function "public"."guard_maintenance_event_writes"() owner to "postgres";

-- Trigger functions have no business on the public API. Revoking EXECUTE does not stop
-- a trigger, which runs whoever holds the privilege.
revoke execute on function "public"."guard_maintenance_work_order_writes"() from public, "anon", "authenticated";
revoke execute on function "public"."guard_maintenance_labour_writes"() from public, "anon", "authenticated";
revoke execute on function "public"."guard_maintenance_part_writes"() from public, "anon", "authenticated";
revoke execute on function "public"."guard_maintenance_cost_writes"() from public, "anon", "authenticated";
revoke execute on function "public"."guard_maintenance_task_writes"() from public, "anon", "authenticated";
revoke execute on function "public"."guard_maintenance_note_writes"() from public, "anon", "authenticated";
revoke execute on function "public"."guard_maintenance_event_writes"() from public, "anon", "authenticated";

create or replace trigger "maintenance_work_order_guard_writes"
  before insert or update or delete on "public"."maintenance_work_order"
  for each row execute function "public"."guard_maintenance_work_order_writes"();

create or replace trigger "maintenance_work_order_labour_guard_writes"
  before insert or update or delete on "public"."maintenance_work_order_labour"
  for each row execute function "public"."guard_maintenance_labour_writes"();

create or replace trigger "maintenance_work_order_part_guard_writes"
  before insert or update or delete on "public"."maintenance_work_order_part"
  for each row execute function "public"."guard_maintenance_part_writes"();

create or replace trigger "maintenance_work_order_cost_guard_writes"
  before insert or update or delete on "public"."maintenance_work_order_cost"
  for each row execute function "public"."guard_maintenance_cost_writes"();

create or replace trigger "maintenance_work_order_task_guard_writes"
  before insert or update or delete on "public"."maintenance_work_order_task"
  for each row execute function "public"."guard_maintenance_task_writes"();

create or replace trigger "maintenance_work_order_note_guard_writes"
  before insert on "public"."maintenance_work_order_note"
  for each row execute function "public"."guard_maintenance_note_writes"();

create or replace trigger "maintenance_work_order_event_guard_writes"
  before insert on "public"."maintenance_work_order_event"
  for each row execute function "public"."guard_maintenance_event_writes"();
