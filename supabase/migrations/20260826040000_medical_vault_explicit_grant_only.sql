-- The medical vault is reachable by explicit grant only.
--
-- WHAT CHANGES. authz.current_user_can_access_medical_vault admitted anyone whose
-- power_level was 'super_admin', as well as holders of the medical_vault_access
-- capability. The super_admin branch is removed. What remains:
--
--   * a user whose permission profile carries medical_vault_access
--   * the affected worker, for their own records, unchanged
--
-- WHY. This bucket does not hold compliance paperwork. It holds a doctor's account of an
-- injured worker's restrictions -- what they may lift, how long they may stand, when they
-- may drive again. A company placing someone on light duty has to hold that, and exactly
-- one person should be able to read it.
--
-- The super_admin branch quietly defeated that. Every other capability on a permission
-- profile decides what somebody can OPERATE; this one decides what they can read about a
-- colleague's body, and it was being granted as a side effect of being an administrator.
-- At the client this was found on it meant three people could open the vault while the
-- medical_vault_access flag, the thing that was supposed to control it, was set on nobody
-- and doing no work at all. One of the three was the outside safety consultant, who is
-- not an employee of the company. His words, and the reason this migration exists:
-- "although I am super admin, I am not an employee of the company and should not have
-- access to the medical vault."
--
-- THE FAILURE MODE, STATED PLAINLY. A tenant where nobody holds medical_vault_access now
-- has a vault nobody can open, including its owner. That is deliberate and it is the
-- correct failure: who may read an injured colleague's file is a decision a company makes
-- on purpose, not a default it inherits from whoever happens to hold the top role. Grant
-- the capability to one named person.
--
-- Safe to apply where it was written: no tenant held any medical record, so nothing
-- became unreachable. Check before applying anywhere that does.
--
-- The TypeScript mirror is canManageMedicalVault in src/lib/access-control.ts. The two
-- must say the same thing: if they drift, the interface offers what the database refuses,
-- or worse, hides what the database still allows. Change them together.

create or replace function "authz"."current_user_can_access_medical_vault"(
  "target_tenant_id" "uuid",
  "target_driver_id" "uuid"
) returns boolean
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select exists (
    select 1
    from public.users u
    left join public.permission_profiles p on p.id = u.permission_profile_id
    where u.id = auth.uid()
      and u.active = true
      and u.tenant_id = target_tenant_id
      and (
        -- Granted on purpose, to a named person, and to nobody by default.
        coalesce((p.capabilities ->> 'medical_vault_access')::boolean, false)
        -- The worker the file is about. Never taken away: a person may always read
        -- what has been recorded about their own injury.
        or exists (
          select 1
          from public.transport_driver d
          where d.id = target_driver_id
            and d.tenant_id = target_tenant_id
            and d.user_id = u.id
        )
      )
  );
$$;

alter function "authz"."current_user_can_access_medical_vault"("uuid", "uuid") owner to "postgres";
