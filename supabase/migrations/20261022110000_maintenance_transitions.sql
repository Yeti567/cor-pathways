-- Maintenance module: moving a work order, and issuing and returning its parts.
--
-- Every status change goes through transition_maintenance_work_order, and every part
-- that touches stock goes through issue_ or return_maintenance_work_order_part. The lesson
-- from purchasing (20261022060000) is applied from the start:
--
--   * the actor is always the signed-in user (auth.uid()), never an argument;
--   * the caller names an action ("complete"), never a destination status, and the
--     function works out the move itself, mirroring planMaintenanceTransition in
--     src/lib/maintenance.ts;
--   * completion needs notes, and a meter reading when the asset is metered;
--   * completing completes the corrective action the work order came from, and advances
--     the scheduled service it came from by the completion date or meter;
--   * closing writes the job into the asset's maintenance history and the reading into
--     its meter log, and locks the costs; only an admin reopens, and only with a reason.
--
-- Direct writes that would skip these functions are refused by the guard triggers in
-- 20261022120000. The functions open that door for themselves with the transaction-local
-- setting app.maintenance_write, which the guards check.
--
-- Everything stays security invoker except four small authz helpers that read the
-- caller's own users row, the same way authz.current_user_power_level does.

-- --- Who is acting ------------------------------------------------------------

-- An active user of this tenant. Workers act on work orders assigned to them.
create or replace function "authz"."maintenance_is_member"("p_tenant_id" uuid) returns boolean
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.active = true
      and u.tenant_id = p_tenant_id
  );
$$;

-- An active user of this tenant who can open the admin panel, where work orders are
-- approved, assigned, closed and cancelled. Mirrors canManageMaintenance in
-- src/lib/maintenance.ts and canUseAdminPanel in src/lib/access-control.ts.
create or replace function "authz"."maintenance_can_manage"("p_tenant_id" uuid) returns boolean
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.active = true
      and u.tenant_id = p_tenant_id
      and (
        u.app_access in ('admin_access', 'super_admin_access')
        or u.power_level in ('super_admin', 'consultant')
      )
  );
$$;

-- An admin, super admin or consultant who can use the admin panel. Mirrors
-- isMaintenanceAdmin in src/lib/maintenance.ts. Reopens closed work orders.
create or replace function "authz"."maintenance_is_admin"("p_tenant_id" uuid) returns boolean
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.active = true
      and u.tenant_id = p_tenant_id
      and u.power_level in ('admin', 'super_admin', 'consultant')
      and (
        u.app_access in ('admin_access', 'super_admin_access')
        or u.power_level in ('super_admin', 'consultant')
      )
  );
$$;

-- The name the trail shows for the signed-in user, taken from their own row.
create or replace function "authz"."maintenance_actor_name"() returns text
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select coalesce(nullif(btrim(u.full_name), ''), u.email)
  from public.users u
  where u.id = auth.uid()
  limit 1;
$$;

alter function "authz"."maintenance_is_member"(uuid) owner to "postgres";
alter function "authz"."maintenance_can_manage"(uuid) owner to "postgres";
alter function "authz"."maintenance_is_admin"(uuid) owner to "postgres";
alter function "authz"."maintenance_actor_name"() owner to "postgres";

revoke all on function "authz"."maintenance_is_member"(uuid) from public, "anon";
revoke all on function "authz"."maintenance_can_manage"(uuid) from public, "anon";
revoke all on function "authz"."maintenance_is_admin"(uuid) from public, "anon";
revoke all on function "authz"."maintenance_actor_name"() from public, "anon";
grant execute on function "authz"."maintenance_is_member"(uuid) to "authenticated", "service_role";
grant execute on function "authz"."maintenance_can_manage"(uuid) to "authenticated", "service_role";
grant execute on function "authz"."maintenance_is_admin"(uuid) to "authenticated", "service_role";
grant execute on function "authz"."maintenance_actor_name"() to "authenticated", "service_role";

-- --- Facts the rules need --------------------------------------------------------------

-- Whether completing work on this asset needs a meter reading: it tracks a meter (a
-- trailer does not) and has a reading on file. The SQL twin of assetIsMetered.
create or replace function "public"."maintenance_equipment_is_metered"("p_equipment_id" uuid) returns boolean
    language "sql" stable security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
  select coalesce((
    select e.category <> 'trailer' and e.current_meter is not null
      from public.equipment e
     where e.id = p_equipment_id
  ), false);
$$;

alter function "public"."maintenance_equipment_is_metered"(uuid) owner to "postgres";
revoke execute on function "public"."maintenance_equipment_is_metered"(uuid) from public, "anon";
grant execute on function "public"."maintenance_equipment_is_metered"(uuid) to "authenticated", "service_role";

-- Whether the maintenance module is on for a tenant. The pages and actions check it too;
-- this is what stops a direct API call reaching a module that is switched off.
create or replace function "public"."maintenance_module_on"("p_tenant_id" uuid) returns boolean
    language "sql" stable security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
  select coalesce((select t.maintenance_enabled from public.tenants t where t.id = p_tenant_id), false);
$$;

alter function "public"."maintenance_module_on"(uuid) owner to "postgres";
revoke execute on function "public"."maintenance_module_on"(uuid) from public, "anon";
grant execute on function "public"."maintenance_module_on"(uuid) to "authenticated", "service_role";

-- --- Moving a work order ---------------------------------------------------------------

-- p_action is one of: approve, assign, start, hold, complete, close, cancel, reopen.
-- p_reason is required to hold, cancel and reopen. p_notes and p_meter are read by
-- complete only. Returns the work order's new status.
create or replace function "public"."transition_maintenance_work_order"(
  "p_work_order_id" uuid,
  "p_action" text,
  "p_reason" text default null,
  "p_notes" text default null,
  "p_meter" numeric default null
) returns text
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  wo public.maintenance_work_order%rowtype;
  actor uuid := auth.uid();
  actor_label text;
  is_manager boolean;
  is_admin boolean;
  is_assignee boolean;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  notes text := nullif(btrim(coalesce(p_notes, '')), '');
  next_status text;
  event_action text;
  last_meter numeric;
  metered boolean := false;
  svc public.equipment_scheduled_service%rowtype;
  completed_on date := current_date;
  recurring boolean;
  next_due_date date;
  next_due_meter numeric;
  meter_delta numeric;
  log_type text;
  log_id uuid;
  meter_id uuid;
  wo_label text;
  previous_status text;
begin
  select * into wo from public.maintenance_work_order where id = p_work_order_id for update;

  if not found then
    raise exception 'That work order no longer exists.';
  end if;

  if actor is null or not authz.maintenance_is_member(wo.tenant_id) then
    raise exception 'Only someone in this company can change a work order.'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.maintenance_module_on(wo.tenant_id) then
    raise exception 'The maintenance module is switched off for this company.'
      using errcode = 'insufficient_privilege';
  end if;

  actor_label := authz.maintenance_actor_name();
  is_manager := authz.maintenance_can_manage(wo.tenant_id);
  is_admin := authz.maintenance_is_admin(wo.tenant_id);
  is_assignee := wo.assignee_id is not null and wo.assignee_id = actor;
  wo_label := 'WO-' || lpad(wo.number::text, 6, '0');

  case p_action
    when 'approve' then
      if not is_manager then
        raise exception 'Only someone with admin panel access can approve a work order.'
          using errcode = 'insufficient_privilege';
      end if;
      if wo.status <> 'requested' then
        raise exception 'Only a requested work order can be approved.';
      end if;

      next_status := 'approved';
      event_action := 'approved';

    when 'assign' then
      if not is_manager then
        raise exception 'Only someone with admin panel access can assign a work order.'
          using errcode = 'insufficient_privilege';
      end if;
      if wo.status not in ('requested', 'approved', 'assigned') then
        raise exception 'This work order is already under way, so it cannot be assigned again from here.';
      end if;
      if wo.assignee_id is null then
        raise exception 'Choose who the work order is for first.';
      end if;

      next_status := 'assigned';
      event_action := 'assigned';

    when 'start' then
      if not (is_manager or is_assignee) then
        raise exception 'Only the person it is assigned to, or a manager, can start this work order.'
          using errcode = 'insufficient_privilege';
      end if;
      if wo.status not in ('approved', 'assigned', 'on_hold') then
        raise exception 'Only an approved, assigned or held work order can be started.';
      end if;

      next_status := 'in_progress';
      event_action := 'started';

    when 'hold' then
      if not (is_manager or is_assignee) then
        raise exception 'Only the person it is assigned to, or a manager, can put this work order on hold.'
          using errcode = 'insufficient_privilege';
      end if;
      if wo.status not in ('approved', 'assigned', 'in_progress') then
        raise exception 'Only open work can be put on hold.';
      end if;
      if reason is null then
        raise exception 'Say why the work is on hold.';
      end if;

      next_status := 'on_hold';
      event_action := 'held';

    when 'complete' then
      if not (is_manager or is_assignee) then
        raise exception 'Only the person it is assigned to, or a manager, can complete this work order.'
          using errcode = 'insufficient_privilege';
      end if;
      if wo.status not in ('approved', 'assigned', 'in_progress') then
        raise exception 'Only work that is under way can be completed. Take it off hold first.';
      end if;
      if notes is null then
        raise exception 'Say what was done before completing the work order.';
      end if;

      if wo.equipment_id is not null then
        metered := public.maintenance_equipment_is_metered(wo.equipment_id);
        select e.current_meter into last_meter from public.equipment e where e.id = wo.equipment_id;
      end if;

      if p_meter is not null and p_meter < 0 then
        raise exception 'A meter reading cannot be negative.';
      end if;
      if metered and p_meter is null then
        raise exception 'This asset has a meter. Enter the reading at completion.';
      end if;
      if metered and p_meter < last_meter then
        raise exception 'That reading is lower than the last one on file (%). Check it and try again.', last_meter;
      end if;

      next_status := 'completed';
      event_action := 'completed';

    when 'close' then
      if not is_manager then
        raise exception 'Only someone with admin panel access can close a work order.'
          using errcode = 'insufficient_privilege';
      end if;
      if wo.status <> 'completed' then
        raise exception 'Only a completed work order can be closed.';
      end if;

      next_status := 'closed';
      event_action := 'closed';

    when 'cancel' then
      if not is_manager then
        raise exception 'Only someone with admin panel access can cancel a work order.'
          using errcode = 'insufficient_privilege';
      end if;
      if wo.status not in ('requested', 'approved', 'assigned', 'in_progress', 'on_hold') then
        raise exception 'This work order can no longer be cancelled.';
      end if;
      if reason is null then
        raise exception 'Say why the work order is being cancelled.';
      end if;

      next_status := 'cancelled';
      event_action := 'cancelled';

    when 'reopen' then
      if wo.status <> 'closed' then
        raise exception 'Only a closed work order can be reopened.';
      end if;
      if not is_admin then
        raise exception 'Only an admin can reopen a closed work order.' using errcode = 'insufficient_privilege';
      end if;
      if reason is null then
        raise exception 'Say why the work order is being reopened.';
      end if;

      -- Back to completed, not to the start: the work was done, and the corrective
      -- action and scheduled service it settled stay settled. Costs unlock until it is
      -- closed again.
      next_status := 'completed';
      event_action := 'reopened';

    else
      raise exception 'That is not something a work order can do.';
  end case;

  previous_status := wo.status;

  -- Open the guard triggers for this transaction's own writes, and close them again.
  perform set_config('app.maintenance_write', 'on', true);

  update public.maintenance_work_order
     set status = next_status,
         approved_at = case
           when event_action in ('approved', 'assigned') and approved_at is null then now()
           else approved_at
         end,
         assigned_at = case when event_action = 'assigned' then now() else assigned_at end,
         started_at = case when event_action = 'started' and started_at is null then now() else started_at end,
         completed_at = case when event_action = 'completed' then now() else completed_at end,
         completed_by = case when event_action = 'completed' then actor else completed_by end,
         completion_notes = case when event_action = 'completed' then notes else completion_notes end,
         meter_at_completion = case when event_action = 'completed' then p_meter else meter_at_completion end,
         closed_at = case
           when event_action = 'closed' then now()
           when event_action = 'reopened' then null
           else closed_at
         end,
         closed_by = case
           when event_action = 'closed' then actor
           when event_action = 'reopened' then null
           else closed_by
         end,
         cancelled_at = case when event_action = 'cancelled' then now() else cancelled_at end
   where id = wo.id
  returning * into wo;

  -- Completing settles what the work order came from.
  if event_action = 'completed' then
    -- The corrective action it was raised from, and any later one that was linked to it
    -- because the same item failed again while the work was open.
    update public.follow_ups
       set status = 'completed',
           completed_at = now(),
           updated_at = now()
     where tenant_id = wo.tenant_id
       and (id = wo.follow_up_id or maintenance_work_order_id = wo.id)
       and status not in ('completed', 'signed_off');

    -- Advance the scheduled service from the completion date or meter. The SQL twin of
    -- advanceScheduledService in src/lib/equipment.ts, which preventiveNextDue in
    -- src/lib/maintenance.ts uses: a month is added the way the app adds one, so the
    -- 31st plus one month runs into the next month rather than stopping at its end.
    if wo.scheduled_service_id is not null then
      select * into svc
        from public.equipment_scheduled_service s
       where s.id = wo.scheduled_service_id
         and s.tenant_id = wo.tenant_id
         for update;

      if found then
        recurring := svc.recurrence_unit in ('meter', 'days', 'months') and coalesce(svc.recurrence_value, 0) > 0;
        next_due_date := svc.due_date;
        next_due_meter := svc.due_meter;
        meter_delta := null;

        if recurring then
          if svc.recurrence_unit = 'meter' then
            if p_meter is not null then
              next_due_meter := p_meter + svc.recurrence_value;
            end if;
            if svc.due_meter is not null and next_due_meter is not null then
              meter_delta := next_due_meter - svc.due_meter;
            end if;
          elsif svc.recurrence_unit = 'days' then
            next_due_date := completed_on + svc.recurrence_value;
          else
            next_due_date := (
              make_date(extract(year from completed_on)::integer, extract(month from completed_on)::integer, 1)
              + make_interval(months => svc.recurrence_value)
            )::date + (extract(day from completed_on)::integer - 1);
          end if;
        end if;

        update public.equipment_scheduled_service
           set due_date = next_due_date,
               due_meter = next_due_meter,
               window_start_meter = case when meter_delta is null then window_start_meter else window_start_meter + meter_delta end,
               warn_meter = case when meter_delta is null then warn_meter else warn_meter + meter_delta end,
               is_active = recurring,
               last_completed_at = completed_on,
               last_completed_meter = p_meter,
               action_metadata = jsonb_build_object(
                 'action', 'equipment.service.complete',
                 'actor_id', actor,
                 'captured_at', now(),
                 'source', 'system',
                 'details', jsonb_build_object(
                   'completed_at', completed_on,
                   'completed_meter', p_meter,
                   'next_due_date', next_due_date,
                   'next_due_meter', next_due_meter,
                   'work_order_id', wo.id
                 )
               )
         where id = svc.id;
      end if;
    end if;
  end if;

  -- Closing writes the job into the asset's history, once. A reopen and a second close
  -- update the same rows instead of adding to them.
  if event_action = 'closed' and wo.equipment_id is not null then
    log_type := case wo.type
      when 'preventive' then 'scheduled_service'
      when 'inspection' then 'inspection_service'
      when 'corrective' then 'repair'
      else 'other'
    end;

    select l.id into log_id from public.equipment_maintenance_log l where l.id = wo.maintenance_log_id;

    if log_id is not null then
      update public.equipment_maintenance_log
         set deleted_at = null,
             type = log_type,
             title = wo_label || ': ' || wo.title,
             description = wo.completion_notes,
             performed_at = wo.completed_at::date,
             meter_at_service = wo.meter_at_completion,
             cost = wo.total_cost,
             performed_by = coalesce(wo.assignee_id, wo.completed_by)
       where id = log_id;
    else
      insert into public.equipment_maintenance_log (
        tenant_id, equipment_id, type, title, description, performed_at, meter_at_service, cost,
        performed_by, created_by, action_metadata
      ) values (
        wo.tenant_id, wo.equipment_id, log_type, wo_label || ': ' || wo.title, wo.completion_notes,
        wo.completed_at::date, wo.meter_at_completion, wo.total_cost,
        coalesce(wo.assignee_id, wo.completed_by), actor,
        jsonb_build_object(
          'action', 'maintenance.work_order.close',
          'actor_id', actor,
          'captured_at', now(),
          'source', 'system',
          'details', jsonb_build_object('work_order_id', wo.id, 'number', wo.number)
        )
      )
      returning id into log_id;
    end if;

    if wo.meter_at_completion is not null then
      select m.id into meter_id from public.equipment_meter_log m where m.id = wo.meter_log_id;

      if meter_id is not null then
        update public.equipment_meter_log
           set value = wo.meter_at_completion,
               recorded_at = wo.completed_at
         where id = meter_id
           and (value, recorded_at) is distinct from (wo.meter_at_completion, wo.completed_at);
      else
        insert into public.equipment_meter_log (
          tenant_id, equipment_id, value, recorded_at, recorded_by, source, action_metadata
        ) values (
          wo.tenant_id, wo.equipment_id, wo.meter_at_completion, wo.completed_at, coalesce(wo.completed_by, actor),
          'maintenance',
          jsonb_build_object(
            'action', 'equipment.meter.from_work_order',
            'actor_id', actor,
            'captured_at', now(),
            'source', 'system',
            'details', jsonb_build_object('work_order_id', wo.id, 'value', wo.meter_at_completion)
          )
        )
        returning id into meter_id;
      end if;
    end if;

    update public.maintenance_work_order
       set maintenance_log_id = log_id,
           meter_log_id = coalesce(meter_id, meter_log_id)
     where id = wo.id;
  end if;

  -- A reopened job leaves the asset's history until it is closed again.
  if event_action = 'reopened' and wo.maintenance_log_id is not null then
    update public.equipment_maintenance_log
       set deleted_at = now()
     where id = wo.maintenance_log_id
       and deleted_at is null;
  end if;

  -- clock_timestamp, not now(): two events in one transaction must still sort in the
  -- order they happened.
  insert into public.maintenance_work_order_event (
    tenant_id, work_order_id, action, from_status, to_status, actor_user_id, actor_name, reason, created_at
  ) values (
    wo.tenant_id, wo.id, event_action, previous_status, next_status, actor, actor_label,
    coalesce(reason, case when event_action = 'completed' then notes end),
    clock_timestamp()
  );

  perform set_config('app.maintenance_write', 'off', true);

  return next_status;
end;
$$;

alter function "public"."transition_maintenance_work_order"(uuid, text, text, text, numeric) owner to "postgres";

revoke execute on function "public"."transition_maintenance_work_order"(uuid, text, text, text, numeric) from public, "anon";
grant execute on function "public"."transition_maintenance_work_order"(uuid, text, text, text, numeric) to "authenticated", "service_role";

-- --- Parts through the ledger ----------------------------------------------------------

-- Issues a planned part to the job. A stock part posts an ordinary "consume" movement out
-- of the chosen place through the inventory ledger, whose own trigger moves the balance
-- and refuses an overdraw, and takes the item's unit_cost as its cost. A part described in
-- words is simply marked used at the cost entered. Returns the movement id, or null.
create or replace function "public"."issue_maintenance_work_order_part"(
  "p_part_id" uuid,
  "p_place_id" uuid default null
) returns uuid
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  part public.maintenance_work_order_part%rowtype;
  wo public.maintenance_work_order%rowtype;
  actor uuid := auth.uid();
  place_kind text;
  item_cost numeric(14,4);
  new_movement_id uuid;
begin
  select * into part from public.maintenance_work_order_part where id = p_part_id for update;

  if not found then
    raise exception 'That part is no longer on the work order.';
  end if;

  select * into wo from public.maintenance_work_order where id = part.work_order_id for update;

  if actor is null or not authz.maintenance_is_member(wo.tenant_id) then
    raise exception 'Only someone in this company can issue parts.' using errcode = 'insufficient_privilege';
  end if;

  if not public.maintenance_module_on(wo.tenant_id) then
    raise exception 'The maintenance module is switched off for this company.' using errcode = 'insufficient_privilege';
  end if;

  if not (authz.maintenance_can_manage(wo.tenant_id) or wo.assignee_id = actor) then
    raise exception 'Only the person it is assigned to, or a manager, can issue parts to this work order.'
      using errcode = 'insufficient_privilege';
  end if;

  if wo.status in ('closed', 'cancelled') then
    raise exception 'This work order is % so its costs are locked.', wo.status using errcode = 'insufficient_privilege';
  end if;

  if part.status <> 'planned' then
    raise exception 'Only a planned part can be issued.';
  end if;

  perform set_config('app.maintenance_write', 'on', true);

  if part.item_id is null then
    update public.maintenance_work_order_part
       set status = 'issued',
           to_order = false,
           issued_at = now(),
           issued_by = actor
     where id = part.id;
  else
    if p_place_id is null then
      raise exception 'Choose where the part is coming from.';
    end if;

    select il.kind into place_kind
      from public.inventory_location il
     where il.id = p_place_id
       and il.tenant_id = wo.tenant_id
       and il.active;

    if place_kind is null then
      raise exception 'That stocking place is not available.';
    end if;

    if place_kind in ('transit', 'loss') then
      raise exception 'Issue from a real place, not transit or write-off.';
    end if;

    select round(coalesce(i.unit_cost, 0), 4) into item_cost
      from public.inventory_item i
     where i.id = part.item_id
       and i.tenant_id = wo.tenant_id;

    if not found then
      raise exception 'That item is not in this company.';
    end if;

    insert into public.inventory_movement (
      tenant_id, item_id, qty, from_location_id, to_location_id, movement_type, note, created_by
    ) values (
      wo.tenant_id, part.item_id, part.qty, p_place_id, null, 'consume',
      format('Issued to WO-%s', lpad(wo.number::text, 6, '0')), actor
    )
    returning id into new_movement_id;

    update public.maintenance_work_order_part
       set status = 'issued',
           to_order = false,
           unit_cost = item_cost,
           line_total = round(part.qty * item_cost, 2),
           place_id = p_place_id,
           movement_id = new_movement_id,
           issued_at = now(),
           issued_by = actor
     where id = part.id;
  end if;

  insert into public.maintenance_work_order_event (
    tenant_id, work_order_id, action, actor_user_id, actor_name, reason, created_at
  ) values (
    wo.tenant_id, wo.id, 'part_issued', actor, authz.maintenance_actor_name(),
    format('%s %s of %s', part.qty::text, part.unit, part.description), clock_timestamp()
  );

  perform set_config('app.maintenance_write', 'off', true);

  return new_movement_id;
end;
$$;

-- Puts an issued part back. A stock part posts a "reversal" movement into the place it was
-- issued from, so the ledger explains both directions, and stops counting as a cost.
create or replace function "public"."return_maintenance_work_order_part"("p_part_id" uuid) returns uuid
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  part public.maintenance_work_order_part%rowtype;
  wo public.maintenance_work_order%rowtype;
  actor uuid := auth.uid();
  new_movement_id uuid;
begin
  select * into part from public.maintenance_work_order_part where id = p_part_id for update;

  if not found then
    raise exception 'That part is no longer on the work order.';
  end if;

  select * into wo from public.maintenance_work_order where id = part.work_order_id for update;

  if actor is null or not authz.maintenance_is_member(wo.tenant_id) then
    raise exception 'Only someone in this company can return parts.' using errcode = 'insufficient_privilege';
  end if;

  if not public.maintenance_module_on(wo.tenant_id) then
    raise exception 'The maintenance module is switched off for this company.' using errcode = 'insufficient_privilege';
  end if;

  if not (authz.maintenance_can_manage(wo.tenant_id) or wo.assignee_id = actor) then
    raise exception 'Only the person it is assigned to, or a manager, can return parts from this work order.'
      using errcode = 'insufficient_privilege';
  end if;

  if wo.status in ('closed', 'cancelled') then
    raise exception 'This work order is % so its costs are locked.', wo.status using errcode = 'insufficient_privilege';
  end if;

  if part.status <> 'issued' then
    raise exception 'Only an issued part can be returned.';
  end if;

  perform set_config('app.maintenance_write', 'on', true);

  if part.item_id is not null then
    insert into public.inventory_movement (
      tenant_id, item_id, qty, from_location_id, to_location_id, movement_type, note, created_by
    ) values (
      wo.tenant_id, part.item_id, part.qty, null, part.place_id, 'reversal',
      format('Returned from WO-%s', lpad(wo.number::text, 6, '0')), actor
    )
    returning id into new_movement_id;
  end if;

  update public.maintenance_work_order_part
     set status = 'returned',
         return_movement_id = new_movement_id,
         returned_at = now()
   where id = part.id;

  insert into public.maintenance_work_order_event (
    tenant_id, work_order_id, action, actor_user_id, actor_name, reason, created_at
  ) values (
    wo.tenant_id, wo.id, 'part_returned', actor, authz.maintenance_actor_name(),
    format('%s %s of %s', part.qty::text, part.unit, part.description), clock_timestamp()
  );

  perform set_config('app.maintenance_write', 'off', true);

  return new_movement_id;
end;
$$;

alter function "public"."issue_maintenance_work_order_part"(uuid, uuid) owner to "postgres";
alter function "public"."return_maintenance_work_order_part"(uuid) owner to "postgres";

revoke execute on function "public"."issue_maintenance_work_order_part"(uuid, uuid) from public, "anon";
revoke execute on function "public"."return_maintenance_work_order_part"(uuid) from public, "anon";
grant execute on function "public"."issue_maintenance_work_order_part"(uuid, uuid) to "authenticated", "service_role";
grant execute on function "public"."return_maintenance_work_order_part"(uuid) to "authenticated", "service_role";
