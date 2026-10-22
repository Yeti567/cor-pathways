import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The purchasing approval rules are enforced by the database as well as the app. These
// are static checks, in the style of tests/schema-rls.test.ts, that the enforcement is
// there: no function trusts the caller for the actor or the destination status, and
// every purchasing table refuses the direct writes that would skip the functions.
// supabase/tests/purchasing-approvals.sql exercises the same rules against a database.
// Normalised to LF: a Windows checkout with core.autocrlf stores CRLF, and these checks
// match multi-line source text, so they must not depend on how git wrote the file.
const read = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8").replace(/\r\n/g, "\n");

// Built from char codes so this file never contains the characters it looks for.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

const enforcementSql = read("supabase/migrations/20261022060000_purchase_approval_enforcement.sql");
const guardsSql = read("supabase/migrations/20261022070000_purchase_write_guards.sql");
const scenarioSql = read("supabase/tests/purchasing-approvals.sql");
const actions = read("src/app/admin/purchasing/actions.ts");

// Lowercase, quotes and line comments gone, whitespace flattened: the same reading
// schema-rls uses, so phrasing does not decide the result.
const flatten = (sql: string) =>
  sql
    .toLowerCase()
    .replace(/--[^\n]*/g, "")
    .replace(/"/g, "")
    .replace(/\s+/g, " ");

const enforcement = flatten(enforcementSql);
const guards = flatten(guardsSql);

function functionBody(sql: string, name: string) {
  const start = sql.indexOf(`create or replace function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const bodyStart = sql.indexOf("$$", start);
  const bodyEnd = sql.indexOf("$$", bodyStart + 2);
  return { header: sql.slice(start, bodyStart), body: sql.slice(bodyStart, bodyEnd) };
}

describe("the purchasing functions trust nothing the caller says about who or where", () => {
  it("drops the old signatures that took the actor and the next status", () => {
    expect(enforcement).toContain(
      "drop function if exists public.transition_purchase_order(uuid, text, text, text, text, uuid, integer, boolean, boolean, uuid, text)",
    );
    expect(enforcement).toContain(
      "drop function if exists public.receive_purchase_order(uuid, jsonb, date, text, text, text, uuid, text)",
    );
  });

  it.each(["public.transition_purchase_order", "public.receive_purchase_order"])(
    "%s takes no actor or status argument and reads the actor from the session",
    (name) => {
      const { header, body } = functionBody(enforcement, name);

      expect(header).not.toContain("p_actor");
      expect(header).not.toContain("p_next_status");
      expect(header).not.toContain("p_expected_status");
      expect(header).not.toContain("p_rule_id");
      expect(header).toContain("security invoker");
      expect(body).toContain("actor uuid := auth.uid()");
      expect(body).toContain("authz.purchasing_can_act(po.tenant_id)");
      expect(body).toContain("set_config('app.purchase_write', 'on', true)");
      expect(body).toContain("set_config('app.purchase_write', 'off', true)");
      expect(body).toContain("for update");
    },
  );

  it("works out the next status itself, for every action the app offers", () => {
    const { body } = functionBody(enforcement, "public.transition_purchase_order");

    for (const action of ["submit", "withdraw", "approve", "reject", "order", "undo_order", "close", "cancel", "reopen"]) {
      expect(body).toContain(`when '${action}' then`);
    }
    expect(body).toContain("raise exception 'that is not something an order can do.'");
  });

  it("refuses self-approval and a repeat approver in a sequence, and checks the rule", () => {
    const { body } = functionBody(enforcement, "authz.purchase_order_approval_check");

    expect(body).toContain("if actor = po.requester_id then");
    expect(body).toContain("if actor = any(approved_actors) then");
    expect(body).toContain("actor = any(step.approver_ids)");
    expect(body).toContain("authz.purchasing_is_admin(po.tenant_id)");
    expect(body).toContain("authz.purchase_approval_steps(po.tenant_id, po.location_id, po.total)");
  });

  it("lets only an admin reopen a closed order, and only with a reason", () => {
    const { body } = functionBody(enforcement, "public.transition_purchase_order");
    const reopen = body.slice(body.indexOf("when 'reopen' then"));

    expect(reopen).toContain("if not is_admin then");
    expect(reopen).toContain("if reason is null then");
  });

  it("keeps security definer to the three helpers that read the caller's own row, with a pinned search path", () => {
    const definers = enforcement.match(/create or replace function [a-z_.]+\([^)]*\) returns [a-z]+ language sql stable security definer set search_path to 'public'/g) ?? [];

    expect(definers).toHaveLength(3);
    expect((enforcement.match(/security definer/g) ?? []).length).toBe(3);
    expect(guards).not.toContain("security definer");
  });

  it("keeps the app's calls in step with the new signatures", () => {
    expect(actions).not.toContain("p_actor_user_id");
    expect(actions).not.toContain("p_actor_name");
    expect(actions).not.toContain("p_next_status");
  });
});

describe("direct writes to the purchasing tables are guarded", () => {
  const triggers: [string, string, string][] = [
    ["purchase_order", "before insert or update or delete", "public.guard_purchase_order_writes()"],
    ["purchase_order_line", "before insert or update or delete", "public.guard_purchase_order_line_writes()"],
    ["purchase_order_event", "before insert", "public.guard_purchase_order_event_writes()"],
    ["purchase_receipt", "before insert", "public.guard_purchase_receipt_writes()"],
    ["purchase_receipt_line", "before insert", "public.guard_purchase_receipt_writes()"],
    ["purchase_approval_rule", "before insert or update or delete", "public.guard_purchase_rule_writes()"],
    ["purchase_settings", "before insert or update or delete", "public.guard_purchase_rule_writes()"],
  ];

  it.each(triggers)("guards %s", (table, timing, fn) => {
    expect(guards).toContain(`${timing} on public.${table} for each row execute function ${fn}`);
  });

  it("opens only for the functions' own transaction-local flag, or for a write with no user", () => {
    expect(guards).toContain("select coalesce(current_setting('app.purchase_write', true), '') = 'on'");
    expect((guards.match(/if public\.purchase_write_open\(\) or auth\.uid\(\) is null then/g) ?? []).length).toBe(4);
  });

  it("refuses a direct change to status, its timestamps, the requester or the number", () => {
    const { body } = functionBody(guards, "public.guard_purchase_order_writes");

    for (const column of [
      "status",
      "submitted_at",
      "approved_at",
      "rejected_at",
      "ordered_at",
      "received_at",
      "closed_at",
      "cancelled_at",
      "requester_id",
      "number",
    ]) {
      expect(body).toContain(`new.${column}`);
    }
    expect(body).toContain("a purchase order is cancelled, not deleted");
    expect(body).toContain("if new.requester_id is distinct from auth.uid() then");
    expect(body).toContain("public.purchase_order_editable_by_me(old.id)");
  });

  it("locks lines outside the editable statuses and keeps received quantities for receiving", () => {
    const { body } = functionBody(guards, "public.guard_purchase_order_line_writes");

    expect(body).toContain("public.purchase_order_editable_by_me(target_order)");
    expect(body).toContain("received quantities change only by receiving");
    expect(body).toContain("round(new.qty_ordered * new.unit_cost, 2)");
  });

  it("takes the trail's actor from the session and allows only created and exported directly", () => {
    const { body } = functionBody(guards, "public.guard_purchase_order_event_writes");

    expect(body).toContain("if new.action not in ('created', 'exported') then");
    expect(body).toContain("new.actor_user_id := auth.uid()");
    expect(body).toContain("new.actor_name := authz.purchasing_actor_name()");
  });

  it("leaves rule and setting changes to admins", () => {
    const { body } = functionBody(guards, "public.guard_purchase_rule_writes");
    expect(body).toContain("authz.purchasing_is_admin(target_tenant)");
  });

  it("takes every guard function off the public API", () => {
    for (const fn of [
      "guard_purchase_order_writes",
      "guard_purchase_order_line_writes",
      "guard_purchase_order_event_writes",
      "guard_purchase_receipt_writes",
      "guard_purchase_rule_writes",
    ]) {
      expect(guards).toContain(`revoke execute on function public.${fn}() from public, anon, authenticated`);
    }
  });
});

describe("the SQL scenario test", () => {
  it.each([
    "A member cannot set an order''s status directly",
    "A draft cannot jump straight to approved",
    "A member cannot write an approval into the trail under another name",
    "The trail names the signed-in user, taken from the session",
    "The requester cannot approve their own order, even when the rule names them",
    "A non-admin cannot rewrite who approves",
    "Costs are locked once the order is approved",
  ])("covers: %s", (description) => {
    expect(scenarioSql).toContain(description);
  });

  it("turns triggers back on before anything is tested", () => {
    expect(scenarioSql.indexOf("set local session_replication_role = origin")).toBeLessThan(
      scenarioSql.indexOf("select throws_ok("),
    );
  });
});

describe("public repository hygiene", () => {
  it.each([
    "supabase/migrations/20261022060000_purchase_approval_enforcement.sql",
    "supabase/migrations/20261022070000_purchase_write_guards.sql",
    "supabase/tests/purchasing-approvals.sql",
    "tests/purchasing-enforcement-schema.test.ts",
  ])("uses no em or en dashes in %s", (file) => {
    expect(read(file)).not.toMatch(DASHES);
  });
});
