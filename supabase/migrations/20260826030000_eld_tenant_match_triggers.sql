-- Teach the ELD tenant-match triggers about the contracted target.
--
-- Found by a smoke test, not by the type checker, and it would have taken down every sync
-- for a contracted fleet on the first write.
--
-- Three functions guard eight triggers across eld_vehicle_link, eld_device,
-- eld_vehicle_event, eld_driver_link, eld_driver_event, eld_driver_profile,
-- eld_driver_performance and transport_duty_status_event. Every one of them looked up
-- only the own-fleet table. After 20260826020000 a row carrying a contracted target has a
-- null equipment_id or driver_id, so the lookup matched nothing and the trigger raised
-- "must reference equipment in the same tenant" on a perfectly valid row -- an error
-- pointing at tenancy when the actual subject was the wiring.
--
-- Each function now checks whichever target the row carries. The exactly-one check
-- constraint guarantees there is one, so the final else is a real impossibility rather
-- than a silent pass: a row with neither target is refused here as well, which is what a
-- connector bug would produce.

create or replace function public.eld_vehicle_link_equipment_matches()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.contracted_equipment_id is not null then
    if not exists (
      select 1 from public.contracted_equipment e
      where e.id = new.contracted_equipment_id and e.tenant_id = new.tenant_id
    ) then
      raise exception 'ELD vehicle link must reference a contracted unit in the same tenant.';
    end if;
  elsif new.equipment_id is not null then
    if not exists (
      select 1 from public.equipment e
      where e.id = new.equipment_id and e.tenant_id = new.tenant_id
    ) then
      raise exception 'ELD vehicle link must reference equipment in the same tenant.';
    end if;
  else
    raise exception 'ELD vehicle link must reference either equipment or a contracted unit.';
  end if;

  return new;
end;
$function$;

create or replace function public.eld_driver_link_driver_matches()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.contracted_driver_id is not null then
    if not exists (
      select 1 from public.contracted_driver d
      where d.id = new.contracted_driver_id and d.tenant_id = new.tenant_id
    ) then
      raise exception 'ELD driver link must reference a contracted driver in the same tenant.';
    end if;
  elsif new.driver_id is not null then
    if not exists (
      select 1 from public.transport_driver d
      where d.id = new.driver_id and d.tenant_id = new.tenant_id
    ) then
      raise exception 'ELD driver link must reference a driver in the same tenant.';
    end if;
  else
    raise exception 'ELD driver link must reference either a driver or a contracted driver.';
  end if;

  return new;
end;
$function$;

create or replace function public.transport_duty_status_driver_matches()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.contracted_driver_id is not null then
    if not exists (
      select 1 from public.contracted_driver d
      where d.id = new.contracted_driver_id and d.tenant_id = new.tenant_id
    ) then
      raise exception 'Duty-status event contracted driver must belong to the same tenant.';
    end if;
  elsif new.driver_id is not null then
    if not exists (
      select 1 from public.transport_driver d
      where d.id = new.driver_id and d.tenant_id = new.tenant_id
    ) then
      raise exception 'Duty-status event driver must belong to the same tenant.';
    end if;
  else
    raise exception 'Duty-status event must reference either a driver or a contracted driver.';
  end if;

  return new;
end;
$function$;
