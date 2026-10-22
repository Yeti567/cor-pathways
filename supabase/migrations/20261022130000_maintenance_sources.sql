-- Maintenance: work orders raised from a corrective action or a scheduled service.
--
-- Two doors, each a security-invoker function that looks for an open work order for the
-- same asset and source first and hands that back instead of making a second one. The
-- partial unique index maintenance_work_order_open_source_key (20261022090000) is what
-- makes that hold when two of them run at the same moment: the loser of the race catches
-- the unique violation and returns the winner's work order.
--
--   create_work_order_from_follow_up   the "Create work order" button on a corrective
--                                      action. The follow-up and the work order point at
--                                      each other, and completing the work order completes
--                                      the follow-up (transition_maintenance_work_order).
--   create_preventive_work_order       a scheduled service that has come due, from the
--                                      daily cron or the "Check scheduled service now"
--                                      button. Completing the work order advances the
--                                      service from the completion date or meter.
--
-- Which services are due is worked out in src/lib/maintenance.ts (preventiveWorkOrdersDue)
-- with the same due rules the equipment screens use, so the cron and the screens agree.
-- The function only refuses what must never happen: a duplicate, another tenant's
-- service, a retired one, or a tenant with the module off.

alter table "public"."follow_ups"
  add column if not exists "maintenance_work_order_id" uuid;

comment on column "public"."follow_ups"."maintenance_work_order_id" is
  'The maintenance work order raised for this corrective action. Completing that work order completes this action.';

alter table only "public"."follow_ups"
  drop constraint if exists "follow_ups_maintenance_work_order_id_fkey";

alter table only "public"."follow_ups"
  add constraint "follow_ups_maintenance_work_order_id_fkey" foreign key ("maintenance_work_order_id") references "public"."maintenance_work_order"("id") on delete set null;

create index if not exists "follow_ups_maintenance_work_order_idx"
  on "public"."follow_ups" ("maintenance_work_order_id") where "maintenance_work_order_id" is not null;

-- --- From a corrective action ----------------------------------------------------------

create or replace function "public"."create_work_order_from_follow_up"(
  "p_follow_up_id" uuid,
  "p_priority" text default null
) returns uuid
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  fu public.follow_ups%rowtype;
  actor uuid := auth.uid();
  existing uuid;
  new_id uuid;
  wanted_priority text := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'normal');
begin
  select * into fu from public.follow_ups where id = p_follow_up_id for update;

  if not found then
    raise exception 'That corrective action no longer exists.';
  end if;

  if actor is null or not authz.maintenance_can_manage(fu.tenant_id) then
    raise exception 'Only someone with admin panel access can raise a work order from a corrective action.'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.maintenance_module_on(fu.tenant_id) then
    raise exception 'The maintenance module is switched off for this company.' using errcode = 'insufficient_privilege';
  end if;

  if wanted_priority not in ('urgent', 'high', 'normal', 'low') then
    raise exception 'That is not a work order priority.';
  end if;

  if fu.status in ('completed', 'signed_off') then
    raise exception 'This corrective action is already complete.';
  end if;

  -- Already linked to an open work order: that is the one.
  select wo.id into existing
    from public.maintenance_work_order wo
   where wo.id = fu.maintenance_work_order_id
     and wo.status in ('requested', 'approved', 'assigned', 'in_progress', 'on_hold');

  if existing is null then
    select wo.id into existing
      from public.maintenance_work_order wo
     where wo.tenant_id = fu.tenant_id
       and wo.follow_up_id = fu.id
       and wo.status in ('requested', 'approved', 'assigned', 'in_progress', 'on_hold')
     order by wo.created_at
     limit 1;
  end if;

  perform set_config('app.maintenance_write', 'on', true);

  if existing is null then
    begin
      insert into public.maintenance_work_order (
        tenant_id, title, description, equipment_id, type, priority, status, source, source_id,
        follow_up_id, submission_id, form_item_id, requester_id, created_by, due_date
      ) values (
        fu.tenant_id, fu.title, fu.description, fu.equipment_id, 'corrective', wanted_priority, 'requested',
        'follow_up', fu.id, fu.id, fu.parent_submission_id, fu.form_item_id, actor, actor, fu.due_at::date
      )
      returning id into new_id;
    exception when unique_violation then
      select wo.id into new_id
        from public.maintenance_work_order wo
       where wo.tenant_id = fu.tenant_id
         and wo.source = 'follow_up'
         and wo.source_id = fu.id
         and wo.status in ('requested', 'approved', 'assigned', 'in_progress', 'on_hold')
       limit 1;
    end;
  else
    new_id := existing;
  end if;

  update public.follow_ups
     set maintenance_work_order_id = new_id,
         updated_at = now()
   where id = fu.id
     and maintenance_work_order_id is distinct from new_id;

  perform set_config('app.maintenance_write', 'off', true);

  return new_id;
end;
$$;

alter function "public"."create_work_order_from_follow_up"(uuid, text) owner to "postgres";
revoke execute on function "public"."create_work_order_from_follow_up"(uuid, text) from public, "anon";
grant execute on function "public"."create_work_order_from_follow_up"(uuid, text) to "authenticated", "service_role";

-- --- From a scheduled service ----------------------------------------------------------

-- Raises the preventive work order for one scheduled service, or returns the open one it
-- already has. Callable by a manager from the screens, and by the daily cron, which runs
-- as the service role with no signed-in user.
create or replace function "public"."create_preventive_work_order"(
  "p_service_id" uuid,
  "p_priority" text default 'normal'
) returns uuid
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  svc public.equipment_scheduled_service%rowtype;
  actor uuid := auth.uid();
  existing uuid;
  new_id uuid;
  wanted_priority text := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'normal');
  unit_label text;
begin
  select * into svc from public.equipment_scheduled_service where id = p_service_id for update;

  if not found then
    raise exception 'That scheduled service no longer exists.';
  end if;

  if actor is not null and not authz.maintenance_can_manage(svc.tenant_id) then
    raise exception 'Only someone with admin panel access can raise preventive work orders.'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.maintenance_module_on(svc.tenant_id) then
    raise exception 'The maintenance module is switched off for this company.' using errcode = 'insufficient_privilege';
  end if;

  if wanted_priority not in ('urgent', 'high', 'normal', 'low') then
    raise exception 'That is not a work order priority.';
  end if;

  if not svc.is_active or svc.deleted_at is not null then
    raise exception 'That scheduled service is no longer active.';
  end if;

  select wo.id into existing
    from public.maintenance_work_order wo
   where wo.tenant_id = svc.tenant_id
     and wo.source = 'scheduled_service'
     and wo.source_id = svc.id
     and wo.status in ('requested', 'approved', 'assigned', 'in_progress', 'on_hold')
   limit 1;

  if existing is not null then
    return existing;
  end if;

  select e.unit_number into unit_label from public.equipment e where e.id = svc.equipment_id;

  perform set_config('app.maintenance_write', 'on', true);

  begin
    insert into public.maintenance_work_order (
      tenant_id, title, description, equipment_id, type, priority, status, source, source_id,
      scheduled_service_id, requester_id, created_by, due_date
    ) values (
      svc.tenant_id,
      svc.title,
      format('Scheduled service on unit %s came due.', coalesce(unit_label, 'unknown')),
      svc.equipment_id, 'preventive', wanted_priority, 'requested', 'scheduled_service', svc.id,
      svc.id, actor, actor, svc.due_date
    )
    returning id into new_id;
  exception when unique_violation then
    select wo.id into new_id
      from public.maintenance_work_order wo
     where wo.tenant_id = svc.tenant_id
       and wo.source = 'scheduled_service'
       and wo.source_id = svc.id
       and wo.status in ('requested', 'approved', 'assigned', 'in_progress', 'on_hold')
     limit 1;
  end;

  perform set_config('app.maintenance_write', 'off', true);

  return new_id;
end;
$$;

alter function "public"."create_preventive_work_order"(uuid, text) owner to "postgres";
revoke execute on function "public"."create_preventive_work_order"(uuid, text) from public, "anon";
grant execute on function "public"."create_preventive_work_order"(uuid, text) to "authenticated", "service_role";
