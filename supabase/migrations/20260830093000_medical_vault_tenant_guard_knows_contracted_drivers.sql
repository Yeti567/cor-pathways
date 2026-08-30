-- The vault's tenant guard has to know about contracted drivers too.
--
-- WHAT THIS FIXES. 20260830090000 let transport_medical_record name a contracted driver
-- instead of an employee, and stopped there. The BEFORE INSERT trigger
-- transport_medical_record_driver_matches was left checking only transport_driver, so
-- every contracted-driver row was refused with "Medical record driver must belong to the
-- same tenant." -- a message about a column that is now legitimately null.
--
-- Caught on the first real insert, which is the good case: the guard failed closed and
-- the loader rolled its upload back out of the bucket. It is worth writing down anyway,
-- because a column change that passes a typecheck and a schema review can still be
-- rejected by a trigger nobody looked at. Changing what a column may hold means reading
-- every trigger on the table, not only its constraints.
--
-- The guard itself is doing real work and is kept: it is what stops one tenant's medical
-- record being filed against another tenant's driver, which in this bucket would put a
-- person's health information in front of a different company's vault holder.

create or replace function "public"."transport_medical_record_driver_matches"()
  returns trigger
  language plpgsql
  as $$
begin
  -- Exactly one of the two is set; the check constraint on the table enforces that, so
  -- these branches are mutually exclusive by construction.
  if new.driver_id is not null then
    if not exists (
      select 1 from public.transport_driver d
      where d.id = new.driver_id and d.tenant_id = new.tenant_id
    ) then
      raise exception 'Medical record driver must belong to the same tenant.';
    end if;

  elsif new.contracted_driver_id is not null then
    -- deleted_at is checked here and not on the employee branch because contracted
    -- drivers are soft deleted. Filing a health record against a driver who has been
    -- removed leaves it on nobody's file.
    if not exists (
      select 1 from public.contracted_driver d
      where d.id = new.contracted_driver_id
        and d.tenant_id = new.tenant_id
        and d.deleted_at is null
    ) then
      raise exception 'Medical record contracted driver must belong to the same tenant.';
    end if;

  else
    -- Unreachable while the check constraint stands. Kept so that if the constraint is
    -- ever relaxed, the failure is this sentence rather than a row belonging to nobody.
    raise exception 'Medical record must name a driver or a contracted driver.';
  end if;

  return new;
end;
$$;
