-- Slice 3: a failed inspection item raises a work order.
--
-- A failed item already raises its corrective action (follow_ups), offline on the phone
-- and synced later; that does not change by a single field. This trigger runs after the
-- corrective action lands and, only when every one of these holds, raises a maintenance
-- work order and links the two:
--
--   * the tenant has the maintenance module on (off: return at once, nothing else runs,
--     which is how a trucking tenant keeps exactly the behaviour it has today);
--   * the action came from a submitted form item (form_item_id and parent_submission_id);
--   * that item is flaggable and its settings say autoWorkOrder: true;
--   * the submission recorded that item as a fail;
--   * the submission is tied to an asset: the action's own equipment_id, or failing that
--     the asset the submission was linked to.
--
-- Priority comes from the item's settings.severity: critical to urgent, major to high,
-- minor (or none) to normal. The SQL twin of priorityForSeverity in
-- src/lib/maintenance.ts. Critical also takes the unit out of service, which is the
-- existing behaviour and happens on the phone (createInspectionDefectFollowUps).
--
-- One open work order per item and asset: if one is already open, the new corrective
-- action is linked to it instead of raising a second. The partial unique index
-- maintenance_work_order_open_source_key holds that when two syncs land at once.

create or replace function "public"."create_inspection_work_order"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  item public.form_items%rowtype;
  asset uuid;
  severity text;
  wanted_priority text;
  failed boolean;
  existing uuid;
  previous_flag text;
begin
  if new.form_item_id is null or new.parent_submission_id is null then
    return new;
  end if;

  -- Module off: exactly the behaviour a tenant without maintenance has always had.
  if not public.maintenance_module_on(new.tenant_id) then
    return new;
  end if;

  select * into item
    from public.form_items fi
   where fi.id = new.form_item_id
     and fi.tenant_id = new.tenant_id;

  if not found or not item.flaggable then
    return new;
  end if;

  if jsonb_typeof(item.settings) is distinct from 'object'
     or (item.settings -> 'autoWorkOrder') is distinct from 'true'::jsonb then
    return new;
  end if;

  select exists (
    select 1
      from public.submission_values sv
     where sv.submission_id = new.parent_submission_id
       and sv.form_item_id = new.form_item_id
       and sv.tenant_id = new.tenant_id
       and (
         sv.value = '"fail"'::jsonb
         or (jsonb_typeof(sv.value) = 'object' and sv.value ->> 'value' = 'fail')
       )
  ) into failed;

  if not failed then
    return new;
  end if;

  asset := new.equipment_id;

  if asset is null then
    select l.equipment_id into asset
      from public.equipment_submission_link l
     where l.submission_id = new.parent_submission_id
       and l.tenant_id = new.tenant_id
     order by l.created_at
     limit 1;
  end if;

  if asset is null then
    return new;
  end if;

  severity := item.settings ->> 'severity';
  wanted_priority := case severity
    when 'critical' then 'urgent'
    when 'major' then 'high'
    else 'normal'
  end;

  select wo.id into existing
    from public.maintenance_work_order wo
   where wo.tenant_id = new.tenant_id
     and wo.source = 'inspection'
     and wo.source_id = new.form_item_id
     and wo.equipment_id = asset
     and wo.status in ('requested', 'approved', 'assigned', 'in_progress', 'on_hold')
   limit 1;

  previous_flag := coalesce(current_setting('app.maintenance_write', true), '');
  perform set_config('app.maintenance_write', 'on', true);

  if existing is null then
    begin
      insert into public.maintenance_work_order (
        tenant_id, title, description, equipment_id, type, priority, status, source, source_id,
        follow_up_id, submission_id, form_item_id, requester_id, created_by, due_date
      ) values (
        new.tenant_id,
        'Repair: ' || item.label,
        new.description,
        asset,
        'corrective',
        wanted_priority,
        'requested',
        'inspection',
        new.form_item_id,
        new.id,
        new.parent_submission_id,
        new.form_item_id,
        auth.uid(),
        auth.uid(),
        case when severity = 'critical' then current_date else null end
      )
      returning id into existing;
    exception when unique_violation then
      select wo.id into existing
        from public.maintenance_work_order wo
       where wo.tenant_id = new.tenant_id
         and wo.source = 'inspection'
         and wo.source_id = new.form_item_id
         and wo.equipment_id = asset
         and wo.status in ('requested', 'approved', 'assigned', 'in_progress', 'on_hold')
       limit 1;
    end;
  end if;

  update public.follow_ups
     set maintenance_work_order_id = existing
   where id = new.id
     and maintenance_work_order_id is distinct from existing;

  perform set_config('app.maintenance_write', previous_flag, true);

  return new;
end;
$$;

alter function "public"."create_inspection_work_order"() owner to "postgres";

-- A trigger function has no business on the public API. Revoking EXECUTE does not stop
-- the trigger, which runs whoever holds the privilege.
revoke execute on function "public"."create_inspection_work_order"() from public, "anon", "authenticated";

create or replace trigger "follow_ups_create_inspection_work_order"
  after insert on "public"."follow_ups"
  for each row execute function "public"."create_inspection_work_order"();
