-- Error sink: see a failure before the client reports it.
--
-- Two classes of failure currently reach nobody. A JavaScript error in a worker's
-- browser is never sent anywhere, because Vercel only sees the request, not what
-- the browser did with the response. And a sync mutation that exhausts its retries
-- is parked in that phone's IndexedDB with its last error: the only human who can
-- see that a pre-trip never left the cab is the driver holding the phone, who
-- reasonably believes they are done. For an offline-first app used from trucks
-- that is both the likeliest failure and the most damaging one.
--
-- Two tables. `app_error` is one row per occurrence, written by the app. Its
-- signature groups occurrences that share a root cause, so ten thousand instances
-- of one crash loop stay one thing to look at. `app_error_signature` is the
-- rollup: first seen, last seen, how many people it hit, a severity worked out by
-- rule, and later a triage note.
--
-- Deliberately NOT a general logging table. It holds failures, not activity;
-- tenant_audit_log already answers who did what.

create table if not exists "public"."app_error" (
  "id" "uuid" default "gen_random_uuid"() not null,
  "tenant_id" "uuid" not null,
  -- Stable grouping key, computed at ingest from the source, kind, route and a
  -- normalised message. Volatile parts (ids, numbers, urls) are stripped before
  -- hashing so the same bug does not present as thousands of distinct problems.
  "signature" "text" not null,
  "source" "text" not null,
  "kind" "text" not null,
  "message" "text" not null,
  "stack" "text",
  "route" "text",
  "user_id" "uuid",
  "user_role" "text",
  -- Which build this came from, so a fix can be told from a regression.
  "release" "text",
  "user_agent" "text",
  "context" "jsonb" default '{}'::"jsonb" not null,
  "occurred_at" timestamp with time zone default "now"() not null,
  "created_at" timestamp with time zone default "now"() not null,
  constraint "app_error_pkey" primary key ("id"),
  constraint "app_error_source_check" check (("source" = any (array['client'::"text", 'sync'::"text", 'server'::"text"])))
);

create table if not exists "public"."app_error_signature" (
  "id" "uuid" default "gen_random_uuid"() not null,
  "tenant_id" "uuid" not null,
  "signature" "text" not null,
  "source" "text" not null,
  "kind" "text" not null,
  "sample_message" "text" not null,
  "sample_route" "text",
  "first_seen_at" timestamp with time zone not null,
  "last_seen_at" timestamp with time zone not null,
  "occurrence_count" integer default 0 not null,
  "affected_user_count" integer default 0 not null,
  "severity" "text" default 'normal'::"text" not null,
  -- Written by the triage step. Describes an error that provably exists; it never
  -- decides whether something is an error, and it can never change anything.
  "triage_note" "text",
  "triage_model" "text",
  "triaged_at" timestamp with time zone,
  "notified_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "resolved_by" "uuid",
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,
  constraint "app_error_signature_pkey" primary key ("id"),
  constraint "app_error_signature_severity_check" check (("severity" = any (array['critical'::"text", 'high'::"text", 'normal'::"text", 'low'::"text"])))
);

alter table only "public"."app_error"
  add constraint "app_error_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."app_error"
  add constraint "app_error_user_id_fkey" foreign key ("user_id") references "public"."users"("id") on delete set null;

alter table only "public"."app_error_signature"
  add constraint "app_error_signature_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

-- One rollup row per distinct failure per tenant. This is what makes the watcher
-- idempotent: it can run every few minutes and upsert without duplicating.
create unique index if not exists "app_error_signature_tenant_signature_idx"
  on "public"."app_error_signature" ("tenant_id", "signature");

-- The watcher's read: what has arrived since it last looked.
create index if not exists "app_error_tenant_created_idx"
  on "public"."app_error" ("tenant_id", "created_at" desc);

create index if not exists "app_error_tenant_signature_idx"
  on "public"."app_error" ("tenant_id", "signature", "created_at" desc);

-- Unresolved failures first, which is the only ordering the admin view cares about.
create index if not exists "app_error_signature_tenant_open_idx"
  on "public"."app_error_signature" ("tenant_id", "last_seen_at" desc)
  where "resolved_at" is null;

create or replace trigger "app_error_signature_set_updated_at"
  before update on "public"."app_error_signature"
  for each row execute function "public"."set_updated_at"();

alter table "public"."app_error" enable row level security;
alter table "public"."app_error_signature" enable row level security;

-- Any signed-in member may report a failure, because the worker whose phone broke
-- is the one who has to send it. They can only write into their own tenant: the
-- tenant comes from the session, never from the payload.
create policy "app_error_member_insert" on "public"."app_error"
  for insert with check (("tenant_id" = "authz"."current_user_tenant_id"()));

-- Reading is admin-only. A stack trace or an error context can carry more about a
-- person than a colleague should see, so this follows tenant_audit_log rather than
-- the ordinary tenant-member pattern.
create policy "app_error_admin_select" on "public"."app_error"
  for select using ((("tenant_id" = "authz"."current_user_tenant_id"())
    and ("authz"."current_user_power_level"() = any (array['super_admin'::"public"."power_level", 'admin'::"public"."power_level"]))));

create policy "app_error_consultant_select" on "public"."app_error"
  for select using ("authz"."is_consultant_allowed"("tenant_id"));

create policy "app_error_signature_admin_select" on "public"."app_error_signature"
  for select using ((("tenant_id" = "authz"."current_user_tenant_id"())
    and ("authz"."current_user_power_level"() = any (array['super_admin'::"public"."power_level", 'admin'::"public"."power_level"]))));

create policy "app_error_signature_consultant_select" on "public"."app_error_signature"
  for select using ("authz"."is_consultant_allowed"("tenant_id"));

-- An admin may mark a failure resolved. Everything else about a signature is the
-- watcher's to write, and the watcher runs with the service role, which bypasses
-- RLS: no client-facing insert or delete policy exists on either table by design.
create policy "app_error_signature_admin_update" on "public"."app_error_signature"
  for update using ((("tenant_id" = "authz"."current_user_tenant_id"())
    and ("authz"."current_user_power_level"() = any (array['super_admin'::"public"."power_level", 'admin'::"public"."power_level"]))))
  with check ((("tenant_id" = "authz"."current_user_tenant_id"())
    and ("authz"."current_user_power_level"() = any (array['super_admin'::"public"."power_level", 'admin'::"public"."power_level"]))));

comment on table "public"."app_error" is
  'One row per failure: a browser error, a sync mutation that exhausted its retries, or a server error. Reported by the app, read by admins only.';

comment on table "public"."app_error_signature" is
  'Rollup of app_error by signature: first and last seen, reach, rule-based severity, and the triage note. Written by the watcher under the service role.';
