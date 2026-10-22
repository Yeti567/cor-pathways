import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The maintenance work order rules are enforced by the database as well as the app. These
// are static checks, in the style of tests/purchasing-enforcement-schema.test.ts, that the
// enforcement is there: no function trusts the caller for the actor or the destination
// status, every maintenance table refuses the direct writes that would skip the functions,
// parts move only through the stock ledger, and purchasing lands its costs on the job.
// supabase/tests/maintenance-work-orders.sql exercises the same rules against a database.
const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), "utf8");

// Lowercase, quotes and line comments gone, whitespace flattened: the same reading
// schema-rls uses, so phrasing does not decide the result.
const flatten = (sql: string) =>
  sql
    .toLowerCase()
    .replace(/--[^\n]*/g, "")
    .replace(/"/g, "")
    .replace(/\s+/g, " ");

const workOrders = flatten(read("supabase/migrations/20261022090000_maintenance_work_orders.sql"));
const details = flatten(read("supabase/migrations/20261022100000_maintenance_work_order_details.sql"));
const transitions = flatten(read("supabase/migrations/20261022110000_maintenance_transitions.sql"));
const guards = flatten(read("supabase/migrations/20261022120000_maintenance_write_guards.sql"));
const sources = flatten(read("supabase/migrations/20261022130000_maintenance_sources.sql"));
const purchaseLink = flatten(read("supabase/migrations/20261022140000_purchase_work_order_link.sql"));
const scenarioSql = read("supabase/tests/maintenance-work-orders.sql");
const adminActions = read("src/app/admin/maintenance/actions.ts");
const workerActions = read("src/app/web/maintenance-actions.ts");
const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

function functionBody(sql: string, name: string) {
  const start = sql.indexOf(`create or replace function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const bodyStart = sql.indexOf("$$", start);
  const bodyEnd = sql.indexOf("$$", bodyStart + 2);
  return { body: sql.slice(bodyStart, bodyEnd), header: sql.slice(start, bodyStart) };
}

describe("the work order functions trust nothing the caller says about who or where", () => {
  it.each([
    [transitions, "public.transition_maintenance_work_order"],
    [transitions, "public.issue_maintenance_work_order_part"],
    [transitions, "public.return_maintenance_work_order_part"],
    [sources, "public.create_work_order_from_follow_up"],
    [sources, "public.create_preventive_work_order"],
  ])("%#: takes no actor or status argument, reads the actor from the session, runs as the caller", (sql, name) => {
    const { body, header } = functionBody(sql, name);

    expect(header).not.toContain("p_actor");
    expect(header).not.toContain("p_status");
    expect(header).not.toContain("p_next_status");
    expect(header).toContain("security invoker");
    expect(body).toContain("actor uuid := auth.uid()");
    expect(body).toContain("set_config('app.maintenance_write', 'on', true)");
    expect(body).toContain("set_config('app.maintenance_write', 'off', true)");
    expect(body).toContain("for update");
    expect(body).toContain("public.maintenance_module_on(");
  });

  it("works out the next status itself, for every action the app offers, and refuses anything else", () => {
    const { body } = functionBody(transitions, "public.transition_maintenance_work_order");

    for (const action of ["approve", "assign", "start", "hold", "complete", "close", "cancel", "reopen"]) {
      expect(body).toContain(`when '${action}' then`);
    }
    expect(body).toContain("raise exception 'that is not something a work order can do.'");
  });

  it("needs notes to complete, and a reading on a metered asset that is not below the last one", () => {
    const { body } = functionBody(transitions, "public.transition_maintenance_work_order");
    const complete = body.slice(body.indexOf("when 'complete' then"), body.indexOf("when 'close' then"));

    expect(complete).toContain("if notes is null then");
    expect(complete).toContain("metered := public.maintenance_equipment_is_metered(wo.equipment_id)");
    expect(complete).toContain("if metered and p_meter is null then");
    expect(complete).toContain("if metered and p_meter < last_meter then");
  });

  it("lets only a manager approve, assign, close and cancel, and only the assignee or a manager do the work", () => {
    const { body } = functionBody(transitions, "public.transition_maintenance_work_order");
    const section = (from: string, to: string) => body.slice(body.indexOf(`when '${from}' then`), body.indexOf(`when '${to}' then`));

    for (const [from, to] of [
      ["approve", "assign"],
      ["assign", "start"],
      ["close", "cancel"],
      ["cancel", "reopen"],
    ]) {
      expect(section(from, to)).toContain("if not is_manager then");
    }
    for (const [from, to] of [
      ["start", "hold"],
      ["hold", "complete"],
      ["complete", "close"],
    ]) {
      expect(section(from, to)).toContain("if not (is_manager or is_assignee) then");
    }
  });

  it("lets only an admin reopen a closed work order, and only with a reason", () => {
    const { body } = functionBody(transitions, "public.transition_maintenance_work_order");
    const reopen = body.slice(body.indexOf("when 'reopen' then"), body.indexOf("else raise exception"));

    expect(reopen).toContain("if not is_admin then");
    expect(reopen).toContain("if reason is null then");
  });

  it("completes the corrective action and advances the scheduled service on completion", () => {
    const { body } = functionBody(transitions, "public.transition_maintenance_work_order");

    expect(body).toContain("update public.follow_ups set status = 'completed'");
    expect(body).toContain("(id = wo.follow_up_id or maintenance_work_order_id = wo.id)");
    expect(body).toContain("update public.equipment_scheduled_service set due_date = next_due_date");
    expect(body).toContain("next_due_meter := p_meter + svc.recurrence_value");
    expect(body).toContain("make_interval(months => svc.recurrence_value)");
  });

  it("writes the asset's maintenance log and meter reading on close, once, and hides the log on reopen", () => {
    const { body } = functionBody(transitions, "public.transition_maintenance_work_order");

    expect(body).toContain("insert into public.equipment_maintenance_log");
    expect(body).toContain("update public.equipment_maintenance_log set deleted_at = null");
    expect(body).toContain("insert into public.equipment_meter_log");
    expect(body).toContain("'maintenance'");
    expect(body).toContain("set maintenance_log_id = log_id");
    expect(body).toContain("update public.equipment_maintenance_log set deleted_at = now()");
  });

  it("keeps security definer to the four helpers that read the caller's own row, with a pinned search path", () => {
    const definers =
      transitions.match(
        /create or replace function authz\.[a-z_]+\([^)]*\) returns [a-z]+ language sql stable security definer set search_path to 'public'/g,
      ) ?? [];

    expect(definers).toHaveLength(4);
    expect((transitions.match(/security definer/g) ?? []).length).toBe(4);
    for (const sql of [workOrders, details, guards, sources, purchaseLink]) {
      expect(sql).not.toContain("security definer");
    }
  });

  it("keeps the app's calls in step: actions name the move, never the status or the actor", () => {
    for (const source of [adminActions, workerActions]) {
      expect(source).toContain('rpc("transition_maintenance_work_order"');
      expect(source).not.toContain("p_actor");
      expect(source).not.toContain("p_status");
      expect(source).not.toMatch(/\.update\(\{[^}]*\bstatus:/);
    }
  });
});

describe("parts move only through the stock ledger", () => {
  it("issues out of a real place as a consume movement at the item's unit cost", () => {
    const { body } = functionBody(transitions, "public.issue_maintenance_work_order_part");

    expect(body).toContain("insert into public.inventory_movement");
    expect(body).toContain("'consume'");
    expect(body).toContain("if place_kind in ('transit', 'loss') then");
    expect(body).toContain("round(coalesce(i.unit_cost, 0), 4)");
    expect(body).toContain("movement_id = new_movement_id");
  });

  it("returns into the place it came from as a reversal movement", () => {
    const { body } = functionBody(transitions, "public.return_maintenance_work_order_part");

    expect(body).toContain("insert into public.inventory_movement");
    expect(body).toContain("'reversal'");
    expect(body).toContain("part.place_id");
    expect(body).toContain("return_movement_id = new_movement_id");
  });

  it("never writes a stock balance directly", () => {
    for (const sql of [details, transitions, guards, sources, purchaseLink]) {
      expect(sql).not.toContain("inventory_balance");
    }
  });

  it("holds a posted part to the movement that explains it", () => {
    expect(details).toContain(
      "item_id is null or status not in ('issued', 'returned') or (movement_id is not null and place_id is not null)",
    );
    expect(details).toContain("item_id is null or status <> 'returned' or return_movement_id is not null");
  });
});

describe("the cost roll-up and its arithmetic", () => {
  it("holds line arithmetic and the total in check constraints", () => {
    expect(details).toContain("cost = round(hours * rate, 2)");
    expect(details).toContain("line_total = round(qty * unit_cost, 2)");
    expect(workOrders).toContain("total_cost = labour_cost + parts_cost + vendor_cost + other_cost");
  });

  it("keeps the roll-up by trigger on labour, parts and costs, counting only used or received parts", () => {
    const { body } = functionBody(details, "public.refresh_maintenance_work_order_costs");

    expect(body).toContain("p.status in ('issued', 'received')");
    expect(body).toContain("previous_flag");
    for (const table of ["maintenance_work_order_labour", "maintenance_work_order_part", "maintenance_work_order_cost"]) {
      expect(details).toContain(
        `after insert or update or delete on public.${table} for each row execute function public.maintenance_work_order_costs_changed()`,
      );
    }
  });

  it("allows one open work order per asset and source, enforced by a unique index", () => {
    expect(workOrders).toContain("create unique index if not exists maintenance_work_order_open_source_key");
    expect(workOrders).toContain("where source <> 'manual' and status in ('requested', 'approved', 'assigned', 'in_progress', 'on_hold')");
    expect(sources.match(/exception when unique_violation then/g) ?? []).toHaveLength(2);
  });
});

describe("direct writes to the maintenance tables are guarded", () => {
  const triggers: [string, string, string][] = [
    ["maintenance_work_order", "before insert or update or delete", "public.guard_maintenance_work_order_writes()"],
    ["maintenance_work_order_labour", "before insert or update or delete", "public.guard_maintenance_labour_writes()"],
    ["maintenance_work_order_part", "before insert or update or delete", "public.guard_maintenance_part_writes()"],
    ["maintenance_work_order_cost", "before insert or update or delete", "public.guard_maintenance_cost_writes()"],
    ["maintenance_work_order_task", "before insert or update or delete", "public.guard_maintenance_task_writes()"],
    ["maintenance_work_order_note", "before insert", "public.guard_maintenance_note_writes()"],
    ["maintenance_work_order_event", "before insert", "public.guard_maintenance_event_writes()"],
  ];

  it.each(triggers)("guards %s", (table, timing, fn) => {
    expect(guards).toContain(`${timing} on public.${table} for each row execute function ${fn}`);
  });

  it("opens only for the functions' own transaction-local flag, or for a write with no user", () => {
    expect(details).toContain("select coalesce(current_setting('app.maintenance_write', true), '') = 'on'");
    expect((guards.match(/if public\.maintenance_write_open\(\) or auth\.uid\(\) is null then/g) ?? []).length).toBe(7);
  });

  it("refuses a direct change to status, its timestamps, completion, the source, the history links or the costs", () => {
    const { body } = functionBody(guards, "public.guard_maintenance_work_order_writes");

    for (const column of [
      "status",
      "approved_at",
      "assigned_at",
      "started_at",
      "completed_at",
      "completed_by",
      "closed_at",
      "closed_by",
      "cancelled_at",
      "completion_notes",
      "meter_at_completion",
      "source",
      "source_id",
      "follow_up_id",
      "scheduled_service_id",
      "maintenance_log_id",
      "meter_log_id",
      "labour_cost",
      "parts_cost",
      "vendor_cost",
      "other_cost",
      "total_cost",
    ]) {
      expect(body).toContain(`new.${column}`);
    }
    expect(body).toContain("a work order is cancelled, not deleted");
    expect(body).toContain("if new.requester_id is distinct from auth.uid() then");
    expect(body).toContain("if new.status <> 'requested'");
    expect(body).toContain("authz.maintenance_can_manage(old.tenant_id)");
  });

  it("locks labour, parts, costs and the checklist once the work order is closed or cancelled", () => {
    for (const fn of [
      "public.guard_maintenance_labour_writes",
      "public.guard_maintenance_part_writes",
      "public.guard_maintenance_cost_writes",
      "public.guard_maintenance_task_writes",
    ]) {
      expect(functionBody(guards, fn).body).toContain("if not public.maintenance_costs_open(target_order) then");
    }
    expect(functionBody(guards, "public.maintenance_costs_open").body).toContain("wo.status not in ('closed', 'cancelled')");
  });

  it("keeps issuing, returning and receiving out of a person's hands", () => {
    const { body } = functionBody(guards, "public.guard_maintenance_part_writes");

    expect(body).toContain("a new part starts as planned");
    expect(body).toContain("parts are issued, returned and received through their own steps");
    expect(body).toContain("this part has been posted, so its quantity and cost are locked");
  });

  it("lets a worker log only their own time on work assigned to them", () => {
    const { body } = functionBody(guards, "public.guard_maintenance_labour_writes");
    expect(body).toContain("public.maintenance_is_assignee(target_order) and new.worker_id = auth.uid()");
    expect(body).toContain("new.created_by := auth.uid()");
  });

  it("takes note authors and checklist ticks from the session, and never lets the trail be written", () => {
    expect(functionBody(guards, "public.guard_maintenance_note_writes").body).toContain("new.author_id := auth.uid()");
    expect(functionBody(guards, "public.guard_maintenance_task_writes").body).toContain("new.done_by := auth.uid()");
    expect(functionBody(guards, "public.guard_maintenance_event_writes").body).toContain(
      "the work order trail records itself",
    );
    expect(details).toContain("revoke update, delete on table public.maintenance_work_order_event from authenticated");
    expect(details).toContain("revoke update, delete on table public.maintenance_work_order_note from authenticated");
  });

  it("takes every guard and trigger function off the public API", () => {
    for (const fn of [
      "guard_maintenance_work_order_writes",
      "guard_maintenance_labour_writes",
      "guard_maintenance_part_writes",
      "guard_maintenance_cost_writes",
      "guard_maintenance_task_writes",
      "guard_maintenance_note_writes",
      "guard_maintenance_event_writes",
    ]) {
      expect(guards).toContain(`revoke execute on function public.${fn}() from public, anon, authenticated`);
    }
    for (const fn of ["maintenance_work_order_costs_changed", "maintenance_work_order_created"]) {
      expect(details).toContain(`revoke execute on function public.${fn}() from public, anon, authenticated`);
    }
  });
});

describe("purchasing lands its costs on the work order", () => {
  it("wires the foreign key slice 1 reserved, in a migration of its own", () => {
    expect(purchaseLink).toContain(
      "add constraint purchase_order_work_order_id_fkey foreign key (work_order_id) references public.maintenance_work_order(id)",
    );
    expect(purchaseLink).toContain("check ((kind = 'work_order_part'::text) = (work_order_part_id is not null))");
  });

  it("puts only a planned part marked to order on an order for its own work order", () => {
    const { body } = functionBody(purchaseLink, "public.guard_purchase_line_work_order_part");
    expect(body).toContain("if part.status <> 'planned' or not part.to_order then");
    expect(body).toContain("if order_work_order is distinct from part.work_order_id then");
  });

  it("keeps receiving's rules and signature, and lands a work order part and a non-stock line on the job", () => {
    const { body, header } = functionBody(purchaseLink, "public.receive_purchase_order");

    expect(header).not.toContain("p_actor");
    expect(body).toContain("actor uuid := auth.uid()");
    expect(body).toContain("authz.purchasing_can_act(po.tenant_id)");
    expect(body).toContain("put the extra on a line of its own");
    expect(body).toContain("if po_line.kind = 'work_order_part' and po_line.work_order_part_id is not null then");
    expect(body).toContain("set status = 'received'");
    expect(body).toContain("if po_line.kind = 'non_stock' and po.work_order_id is not null then");
    expect(body).toContain("insert into public.maintenance_work_order_cost");
    expect(body).toContain("set_config('app.maintenance_write', 'on', true)");
    expect(body).toContain("set_config('app.maintenance_write', 'off', true)");
  });
});

describe("the SQL scenario test", () => {
  it.each([
    "A member cannot set a work order''s status directly",
    "A worker cannot approve a work order",
    "Completion needs notes",
    "Completion on a metered asset needs a reading",
    "Completing completes the corrective action",
    "Completing advances the scheduled service by the completion meter",
    "Closing writes the asset''s maintenance log",
    "Closing writes the completion reading to the meter log",
    "Costs are locked once the work order is closed",
    "Only an admin reopens a closed work order",
    "Issuing a part posts a consume movement through the ledger",
    "Returning a part posts a reversal movement",
    "A second open work order for the same item and asset is refused",
    "With maintenance off, a failed inspection item raises no work order",
    "With maintenance on, a failed critical item raises an urgent work order",
    "The trail cannot be written directly",
  ])("covers: %s", (description) => {
    expect(scenarioSql).toContain(description);
  });

  it("turns triggers back on before anything is tested", () => {
    expect(scenarioSql.indexOf("set local session_replication_role = origin")).toBeLessThan(
      scenarioSql.indexOf("select throws_ok("),
    );
  });

  it("has an npm script", () => {
    expect(packageJson.scripts["supabase:test:maintenance"]).toBe("supabase test db supabase/tests/maintenance-work-orders.sql");
  });
});
