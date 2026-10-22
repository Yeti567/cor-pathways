-- Purchasing: the database enforces the approval rules, not just the app.
--
-- CORRECTION TO 20261022040000 AND 20261022050000. Those functions trusted their caller:
-- transition_purchase_order took the next status, the rule and the actor as arguments,
-- so any member of the tenant could call it over the API, move their own order straight
-- to approved, and write somebody else's name into the trail. receive_purchase_order
-- trusted the actor in the same way. The server actions never did either, but a rule
-- the app keeps and the database does not is a rule anyone with a token can skip.
--
-- Now:
--   * the actor is always the signed-in user (auth.uid()), never an argument;
--   * the caller names an action ("approve"), never a destination status, and the
--     function works out the move itself, mirroring the status machine in
--     src/lib/purchasing.ts;
--   * approval is checked here: never the requester, only an approver of the matching
--     rule (or any admin when there are no rules), a different person at each
--     sequential level, and reopening by an admin only.
--
-- Direct writes that would skip these functions are refused by the guard triggers in
-- 20261022070000. The functions open that door for themselves with a transaction-local
-- setting, app.purchase_write, which the triggers check.
--
-- Everything stays security invoker except three small authz helpers that read the
-- caller's own users row, the same way authz.current_user_power_level does.

-- --- Who is acting ------------------------------------------------------------

-- An active user of this tenant who can open the admin panel, which is where every
-- purchasing screen lives. Mirrors canUseAdminPanel in src/lib/access-control.ts.
create or replace function "authz"."purchasing_can_act"("p_tenant_id" uuid) returns boolean
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
-- isPurchasingAdmin in src/lib/purchasing.ts. Manages rules, reopens closed orders, and
-- approves when the tenant has no rules.
create or replace function "authz"."purchasing_is_admin"("p_tenant_id" uuid) returns boolean
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
create or replace function "authz"."purchasing_actor_name"() returns text
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select coalesce(nullif(btrim(u.full_name), ''), u.email)
  from public.users u
  where u.id = auth.uid()
  limit 1;
$$;

alter function "authz"."purchasing_can_act"(uuid) owner to "postgres";
alter function "authz"."purchasing_is_admin"(uuid) owner to "postgres";
alter function "authz"."purchasing_actor_name"() owner to "postgres";

revoke all on function "authz"."purchasing_can_act"(uuid) from public, "anon";
revoke all on function "authz"."purchasing_is_admin"(uuid) from public, "anon";
revoke all on function "authz"."purchasing_actor_name"() from public, "anon";
grant execute on function "authz"."purchasing_can_act"(uuid) to "authenticated", "service_role";
grant execute on function "authz"."purchasing_is_admin"(uuid) to "authenticated", "service_role";
grant execute on function "authz"."purchasing_actor_name"() to "authenticated", "service_role";

-- --- Which approval an order needs ---------------------------------------------

-- The SQL twin of resolveApprovalRequirement. One row per step:
--   kind 'auto'        below the lowest threshold and the tenant allows it
--   kind 'admin'       no rules: any admin other than the requester
--   kind 'band'        one row; approver_ids holds the matching band and every band above
--   kind 'sequential'  one row per level up to the matching one, in order
-- A location's own active rules replace the company-wide ones. Mixed styles or two
-- sequential rules on one level raise, as the app refuses them too.
create or replace function "authz"."purchase_approval_steps"(
  "p_tenant_id" uuid,
  "p_location_id" uuid,
  "p_total" numeric
) returns table ("step_no" integer, "kind" text, "rule_id" uuid, "level" integer, "approver_ids" uuid[])
    language "plpgsql" stable security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
#variable_conflict use_column
declare
  use_local boolean := false;
  auto_ok boolean;
  style_count integer;
  the_style text;
  total numeric := round(coalesce(p_total, 0), 2);
  matched_threshold numeric;
  matched_rule public.purchase_approval_rule%rowtype;
  top_level integer;
begin
  select s.auto_approve_below_lowest into auto_ok
    from public.purchase_settings s
   where s.tenant_id = p_tenant_id;
  auto_ok := coalesce(auto_ok, false);

  if p_location_id is not null then
    select exists (
      select 1 from public.purchase_approval_rule r
       where r.tenant_id = p_tenant_id and r.active and r.location_id = p_location_id
    ) into use_local;
  end if;

  select count(distinct r.style), min(r.style)
    into style_count, the_style
    from public.purchase_approval_rule r
   where r.tenant_id = p_tenant_id and r.active
     and (case when use_local then r.location_id = p_location_id else r.location_id is null end);

  if style_count = 0 then
    return query select 1, (case when auto_ok then 'auto' else 'admin' end)::text, null::uuid, null::integer, '{}'::uuid[];
    return;
  end if;

  if style_count > 1 then
    raise exception 'The approval rules here mix band and sequential styles. Make them all one style under Rules.';
  end if;

  if the_style = 'band' then
    select max(r.threshold) into matched_threshold
      from public.purchase_approval_rule r
     where r.tenant_id = p_tenant_id and r.active
       and (case when use_local then r.location_id = p_location_id else r.location_id is null end)
       and r.threshold <= total;

    if matched_threshold is null then
      if auto_ok then
        return query select 1, 'auto'::text, null::uuid, null::integer, '{}'::uuid[];
        return;
      end if;

      select min(r.threshold) into matched_threshold
        from public.purchase_approval_rule r
       where r.tenant_id = p_tenant_id and r.active
         and (case when use_local then r.location_id = p_location_id else r.location_id is null end);
    end if;

    select r.* into matched_rule
      from public.purchase_approval_rule r
     where r.tenant_id = p_tenant_id and r.active
       and (case when use_local then r.location_id = p_location_id else r.location_id is null end)
       and r.threshold = matched_threshold
     order by r.created_at desc
     limit 1;

    return query
      select 1, 'band'::text, matched_rule.id, matched_rule.level,
             coalesce((
               select array_agg(distinct a)
                 from public.purchase_approval_rule r, unnest(r.approver_user_ids) a
                where r.tenant_id = p_tenant_id and r.active
                  and (case when use_local then r.location_id = p_location_id else r.location_id is null end)
                  and r.threshold >= matched_threshold
             ), '{}'::uuid[]);
    return;
  end if;

  if exists (
    select 1 from public.purchase_approval_rule r
     where r.tenant_id = p_tenant_id and r.active
       and (case when use_local then r.location_id = p_location_id else r.location_id is null end)
     group by r.level
    having count(*) > 1
  ) then
    raise exception 'Two sequential rules here share a level. Give each level its own number under Rules.';
  end if;

  select max(r.level) into top_level
    from public.purchase_approval_rule r
   where r.tenant_id = p_tenant_id and r.active
     and (case when use_local then r.location_id = p_location_id else r.location_id is null end)
     and r.threshold <= total;

  if top_level is null then
    if auto_ok then
      return query select 1, 'auto'::text, null::uuid, null::integer, '{}'::uuid[];
      return;
    end if;

    select min(r.level) into top_level
      from public.purchase_approval_rule r
     where r.tenant_id = p_tenant_id and r.active
       and (case when use_local then r.location_id = p_location_id else r.location_id is null end);
  end if;

  return query
    select (row_number() over (order by r.level))::integer, 'sequential'::text, r.id, r.level, r.approver_user_ids
      from public.purchase_approval_rule r
     where r.tenant_id = p_tenant_id and r.active
       and (case when use_local then r.location_id = p_location_id else r.location_id is null end)
       and r.level <= top_level
     order by r.level;
end;
$$;

-- Whether the signed-in user may approve (or reject) this order now, under which rule,
-- and whether their approval finishes it. The SQL twin of decideApproval.
create or replace function "authz"."purchase_order_approval_check"("p_order_id" uuid)
returns table ("allowed" boolean, "message" text, "rule_id" uuid, "level" integer, "completes" boolean)
    language "plpgsql" stable security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
#variable_conflict use_column
declare
  po public.purchase_order%rowtype;
  actor uuid := auth.uid();
  reset_at timestamp with time zone;
  approved_rules uuid[];
  approved_actors uuid[];
  approval_count integer;
  step record;
  remaining integer;
begin
  select o.* into po from public.purchase_order o where o.id = p_order_id;

  if not found then
    return query select false, 'That purchase order no longer exists.'::text, null::uuid, null::integer, false;
    return;
  end if;

  if not (
    po.status = 'pending_approval'
    or (po.emergency and po.approved_at is null and po.status in ('ordered', 'partially_received', 'received'))
  ) then
    return query select false, 'This order is not waiting for approval.'::text, null::uuid, null::integer, false;
    return;
  end if;

  if actor is null or not authz.purchasing_can_act(po.tenant_id) then
    return query select false, 'Only someone with admin panel access in this company can approve.'::text, null::uuid, null::integer, false;
    return;
  end if;

  if actor = po.requester_id then
    return query select false, 'You asked for this order, so someone else has to approve it.'::text, null::uuid, null::integer, false;
    return;
  end if;

  -- Approvals given since the order last went (back) to its approvers.
  select max(e.created_at) into reset_at
    from public.purchase_order_event e
   where e.purchase_order_id = po.id
     and e.action in ('created', 'submitted', 'withdrawn', 'rejected', 'order_undone');

  select coalesce(array_agg(e.rule_id) filter (where e.rule_id is not null), '{}'::uuid[]),
         coalesce(array_agg(e.actor_user_id) filter (where e.actor_user_id is not null), '{}'::uuid[]),
         count(*)
    into approved_rules, approved_actors, approval_count
    from public.purchase_order_event e
   where e.purchase_order_id = po.id
     and e.action = 'approved'
     and (reset_at is null or e.created_at > reset_at);

  for step in
    select s.* from authz.purchase_approval_steps(po.tenant_id, po.location_id, po.total) s order by s.step_no
  loop
    if step.kind = 'auto' then
      exit;
    end if;

    if step.kind in ('admin', 'band') then
      if approval_count > 0 then
        exit;
      end if;

      if (step.kind = 'admin' and not authz.purchasing_is_admin(po.tenant_id))
         or (step.kind = 'band' and not (actor = any(step.approver_ids))) then
        return query select false, 'You are not an approver for an order of this size.'::text, null::uuid, null::integer, false;
        return;
      end if;

      return query select true, null::text, step.rule_id, step.level, true;
      return;
    end if;

    -- Sequential: the first level nobody has signed yet is the one waiting.
    if step.rule_id = any(approved_rules) then
      continue;
    end if;

    if not (actor = any(step.approver_ids)) then
      return query select false, 'You are not an approver for an order of this size.'::text, null::uuid, null::integer, false;
      return;
    end if;

    if actor = any(approved_actors) then
      return query select false, 'You have already approved an earlier step. Someone else has to approve this one.'::text,
        null::uuid, null::integer, false;
      return;
    end if;

    select count(*) into remaining
      from authz.purchase_approval_steps(po.tenant_id, po.location_id, po.total) s
     where s.step_no > step.step_no
       and not (s.rule_id = any(approved_rules));

    return query select true, null::text, step.rule_id, step.level, remaining = 0;
    return;
  end loop;

  return query select false, 'This order already has every approval it needs.'::text, null::uuid, null::integer, false;
end;
$$;

alter function "authz"."purchase_approval_steps"(uuid, uuid, numeric) owner to "postgres";
alter function "authz"."purchase_order_approval_check"(uuid) owner to "postgres";

revoke all on function "authz"."purchase_approval_steps"(uuid, uuid, numeric) from public, "anon";
revoke all on function "authz"."purchase_order_approval_check"(uuid) from public, "anon";
grant execute on function "authz"."purchase_approval_steps"(uuid, uuid, numeric) to "authenticated", "service_role";
grant execute on function "authz"."purchase_order_approval_check"(uuid) to "authenticated", "service_role";

-- --- Moving an order ------------------------------------------------------------

-- The old signatures took the next status and the actor from the caller. Gone, so
-- nothing can still reach them.
drop function if exists "public"."transition_purchase_order"(uuid, text, text, text, text, uuid, integer, boolean, boolean, uuid, text);
drop function if exists "public"."receive_purchase_order"(uuid, jsonb, date, text, text, text, uuid, text);

-- p_action is one of: submit, withdraw, approve, reject, order, undo_order, close,
-- cancel, reopen. Returns the order's new status.
create or replace function "public"."transition_purchase_order"(
  "p_order_id" uuid,
  "p_action" text,
  "p_reason" text default null
) returns text
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
declare
  po public.purchase_order%rowtype;
  actor uuid := auth.uid();
  actor_label text;
  is_admin boolean;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  line_count integer;
  any_received boolean;
  outstanding numeric;
  next_status text;
  event_action text;
  is_emergency boolean := false;
  mark_approved boolean := false;
  auto_approve boolean := false;
  require_reason boolean;
  decision_allowed boolean;
  decision_message text;
  decision_rule uuid;
  decision_level integer;
  decision_completes boolean;
begin
  select * into po from public.purchase_order where id = p_order_id for update;

  if not found then
    raise exception 'That purchase order no longer exists.';
  end if;

  if actor is null or not authz.purchasing_can_act(po.tenant_id) then
    raise exception 'Only someone with admin panel access in this company can change a purchase order.'
      using errcode = 'insufficient_privilege';
  end if;

  actor_label := authz.purchasing_actor_name();
  is_admin := authz.purchasing_is_admin(po.tenant_id);

  select count(*),
         coalesce(bool_or(l.qty_received > 0), false),
         coalesce(sum(greatest(l.qty_ordered - l.qty_received, 0)), 0)
    into line_count, any_received, outstanding
    from public.purchase_order_line l
   where l.purchase_order_id = po.id;

  if p_action in ('approve', 'reject') then
    select c.allowed, c.message, c.rule_id, c.level, c.completes
      into decision_allowed, decision_message, decision_rule, decision_level, decision_completes
      from authz.purchase_order_approval_check(po.id) c;
  end if;

  case p_action
    when 'submit' then
      if po.status not in ('draft', 'rejected') then
        raise exception 'Only a draft or a rejected order can be submitted.';
      end if;
      if line_count = 0 then
        raise exception 'Add at least one line first.';
      end if;
      if po.supplier_id is null then
        raise exception 'Choose a supplier first.';
      end if;

      next_status := 'pending_approval';
      event_action := 'submitted';
      select exists (
        select 1 from authz.purchase_approval_steps(po.tenant_id, po.location_id, po.total) s where s.kind = 'auto'
      ) into auto_approve;

    when 'withdraw' then
      if po.status <> 'pending_approval' then
        raise exception 'Only an order waiting for approval can be withdrawn.';
      end if;
      if po.requester_id is distinct from actor and not is_admin then
        raise exception 'Only the requester or an admin can withdraw an order.' using errcode = 'insufficient_privilege';
      end if;

      next_status := 'draft';
      event_action := 'withdrawn';

    when 'approve' then
      if not coalesce(decision_allowed, false) then
        raise exception '%', coalesce(decision_message, 'You cannot approve this order.') using errcode = 'insufficient_privilege';
      end if;

      event_action := 'approved';
      mark_approved := decision_completes;

      if po.status = 'pending_approval' then
        next_status := case when decision_completes then 'approved' else 'pending_approval' end;
      else
        -- An emergency order placed before approval keeps its status.
        next_status := po.status;
        is_emergency := true;
        reason := case
          when reason is null then 'Approved after an emergency order.'
          else 'Approved after an emergency order. ' || reason
        end;
      end if;

    when 'reject' then
      if po.status <> 'pending_approval' then
        if po.emergency and po.approved_at is null and po.status in ('ordered', 'partially_received', 'received') then
          raise exception 'This emergency order has already been placed. Approve it, or cancel it with the supplier first.';
        end if;
        raise exception 'Only an order waiting for approval can be rejected.';
      end if;

      if not coalesce(decision_allowed, false) then
        raise exception '%', coalesce(decision_message, 'You cannot reject this order.') using errcode = 'insufficient_privilege';
      end if;

      select coalesce((select s.require_reject_reason from public.purchase_settings s where s.tenant_id = po.tenant_id), true)
        into require_reason;

      if require_reason and reason is null then
        raise exception 'Say why it is rejected, so the requester knows what to fix.';
      end if;

      next_status := 'rejected';
      event_action := 'rejected';

    when 'order' then
      if line_count = 0 then
        raise exception 'Add at least one line first.';
      end if;
      if po.supplier_id is null then
        raise exception 'Choose a supplier first.';
      end if;

      if po.status = 'approved' then
        next_status := 'ordered';
      elsif po.emergency and po.status in ('draft', 'pending_approval') then
        next_status := 'ordered';
        is_emergency := true;
      else
        raise exception 'An order has to be approved before it is placed, unless it is marked as an emergency.';
      end if;

      event_action := 'ordered';

    when 'undo_order' then
      if po.status <> 'ordered' then
        raise exception 'Only an order that has been placed and not yet received can be undone.';
      end if;
      if any_received then
        raise exception 'Something has already been received against this order, so it cannot be undone.';
      end if;

      next_status := case when po.approved_at is not null then 'approved' else 'draft' end;
      event_action := 'order_undone';

    when 'close' then
      if po.status not in ('received', 'partially_received') then
        raise exception 'Only an order that has been received, in full or in part, can be closed.';
      end if;
      if po.approved_at is null then
        raise exception 'This emergency order still needs its approval before it can be closed.';
      end if;

      next_status := 'closed';
      event_action := 'closed';

    when 'cancel' then
      if po.status = 'ordered' and any_received then
        raise exception 'Something has already been received. Close the order instead.';
      end if;
      if po.status not in ('draft', 'pending_approval', 'rejected', 'approved', 'ordered') then
        raise exception 'This order can no longer be cancelled.';
      end if;

      next_status := 'cancelled';
      event_action := 'cancelled';

    when 'reopen' then
      if po.status <> 'closed' then
        raise exception 'Only a closed order can be reopened.';
      end if;
      if not is_admin then
        raise exception 'Only an admin can reopen a closed order.' using errcode = 'insufficient_privilege';
      end if;
      if reason is null then
        raise exception 'Say why the order is being reopened.';
      end if;

      next_status := case when outstanding > 0 then 'partially_received' else 'received' end;
      event_action := 'reopened';

    else
      raise exception 'That is not something an order can do.';
  end case;

  -- Open the guard triggers for this transaction's own writes, and close them again.
  perform set_config('app.purchase_write', 'on', true);

  update public.purchase_order
     set status = next_status,
         submitted_at = case when event_action = 'submitted' then now() else submitted_at end,
         approved_at = case
           when mark_approved then now()
           when next_status in ('draft', 'pending_approval', 'rejected') then null
           else approved_at
         end,
         rejected_at = case when event_action = 'rejected' then now() else rejected_at end,
         ordered_at = case
           when event_action = 'ordered' then now()
           when event_action = 'order_undone' then null
           else ordered_at
         end,
         closed_at = case
           when event_action = 'closed' then now()
           when event_action = 'reopened' then null
           else closed_at
         end,
         cancelled_at = case when event_action = 'cancelled' then now() else cancelled_at end
   where id = po.id;

  -- clock_timestamp, not now(): two events in one transaction must still sort in the
  -- order they happened, because the approval round is read by time.
  insert into public.purchase_order_event (
    tenant_id, purchase_order_id, action, actor_user_id, actor_name, rule_id, level, reason, emergency, created_at
  ) values (
    po.tenant_id, po.id, event_action, actor, actor_label, decision_rule, decision_level, reason, is_emergency,
    clock_timestamp()
  );

  if auto_approve then
    update public.purchase_order
       set status = 'approved',
           approved_at = now()
     where id = po.id;

    insert into public.purchase_order_event (
      tenant_id, purchase_order_id, action, actor_user_id, actor_name, reason, created_at
    ) values (
      po.tenant_id, po.id, 'approved', null, 'Automatic',
      'Below the lowest approval threshold, so it approved itself.', clock_timestamp()
    );

    next_status := 'approved';
  end if;

  perform set_config('app.purchase_write', 'off', true);

  return next_status;
end;
$$;

alter function "public"."transition_purchase_order"(uuid, text, text) owner to "postgres";

revoke execute on function "public"."transition_purchase_order"(uuid, text, text) from public, "anon";
grant execute on function "public"."transition_purchase_order"(uuid, text, text) to "authenticated", "service_role";

-- --- Receiving ------------------------------------------------------------------

-- As in 20261022050000, but the receiver is the signed-in user, who must be able to use
-- the admin panel in this tenant, and the function opens the guard triggers for its own
-- writes only.
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

  perform set_config('app.purchase_write', 'on', true);

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

  insert into public.purchase_order_event (tenant_id, purchase_order_id, action, actor_user_id, actor_name, reason, created_at)
  values (
    po.tenant_id, po.id, 'received', actor, actor_label,
    case when next_status = 'received' then 'Everything on the order has arrived.'
         else 'Part of the order arrived. The rest is backordered.' end,
    clock_timestamp()
  );

  perform set_config('app.purchase_write', 'off', true);

  return new_receipt_id;
end;
$$;

alter function "public"."receive_purchase_order"(uuid, jsonb, date, text, text, text) owner to "postgres";

revoke execute on function "public"."receive_purchase_order"(uuid, jsonb, date, text, text, text) from public, "anon";
grant execute on function "public"."receive_purchase_order"(uuid, jsonb, date, text, text, text) to "authenticated", "service_role";
