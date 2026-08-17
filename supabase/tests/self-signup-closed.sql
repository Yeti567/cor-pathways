-- One un-invited signup per deployment, enforced in the database.
--
-- This is the test that stops a client's office manager creating her own company
-- inside her employer's database by filling in the signup form, which is exactly
-- what happened on 2026-08-17 and is what migration 20260817000000 closes.
--
-- The application is deliberately not involved here. The anon key ships in every
-- browser bundle, so anyone can POST straight to /auth/v1/signup and never touch
-- our server action. What is under test is that the database refuses even then.
--
-- THE FIXTURES BELOW MIRROR A MEASURED ROW SHAPE, NOT AN ASSUMED ONE. The obvious
-- discriminator, `invited_at`, is NULL at insert time for invitations as well as
-- signups; GoTrue stamps it afterwards. An earlier version of this file asserted
-- otherwise, passed, and shipped a trigger that refused every invitation. What
-- actually differs at INSERT is the password: a signup has one because the endpoint
-- demands it, an invitation does not because the person has not set one yet. So
-- these fixtures set `encrypted_password` exactly as the real endpoints do. If this
-- file is ever changed, re-measure before trusting a new signal.
--
-- Note there is no `set session_replication_role = replica` here, unlike the other
-- suites. The signup trigger is the subject, so it has to be live.
--
-- Run with: supabase test db supabase/tests/self-signup-closed.sql

begin;

set search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(11);

-- The seed leaves tenants in place, so this database is already claimed. That is
-- the state every real deployment is in five minutes after it is stood up.
select isnt_empty(
  'select 1 from public.tenants limit 1',
  'precondition: the deployment already has at least one company'
);

-- 1. Somebody signing themselves up on a claimed deployment is refused outright.
--    A password of their own choosing is what makes this a self-signup.
select throws_ok(
  $$
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values (
      'a1000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'intruder@example.test',
      crypt('Password123!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      '{"company_name":"Any Name I Like","full_name":"Uninvited Person"}',
      now(), now()
    )
  $$,
  '42501',
  'Signing yourself up is closed on this deployment. Ask an administrator to invite you.',
  'signing yourself up on a claimed deployment is refused'
);

-- The refusal must abort the insert, not merely skip the tenant. A stranded auth
-- account with no company is the confusing half-state this is meant to avoid.
select is_empty(
  $$select 1 from auth.users where email = 'intruder@example.test'$$,
  'the refused signup leaves no auth account behind'
);

-- 2. An invitation still gets through, and founds nothing. Empty password, which
--    is what /auth/v1/admin/generate_link actually writes.
select lives_ok(
  $$
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values (
      'a1000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'invited@example.test',
      '', now(),
      '{"provider":"email","providers":["email"]}',
      '{"company_name":"Any Name I Like","full_name":"Invited Person"}',
      now(), now()
    )
  $$,
  'an invited account is created on a claimed deployment'
);

-- Before this migration the invited account got a whole throwaway company, starter
-- forms and all, which the inviting action then had to delete. These two make sure
-- that churn is gone rather than merely tidied up afterwards.
select is_empty(
  $$select 1 from public.tenants where name = 'Any Name I Like'$$,
  'an invitation founds no company, whatever the metadata claims'
);

select is_empty(
  $$select 1 from public.users where id = 'a1000000-0000-0000-0000-000000000002'$$,
  'an invitation creates no user row; the inviting action places them'
);

-- 3. Any other passwordless arrival, an OAuth first login for instance, takes the
--    same branch and must create nothing: no company to hijack, no user row, so RLS
--    has no membership to grant. Null rather than empty string, to pin the coalesce
--    in the trigger.
--
--    Not to be confused with GoTrue's magic-link signup, which writes a password of
--    its own and is therefore refused by the password branch. That was measured
--    against POST /auth/v1/otp, not assumed, and it is intended: nothing in this
--    application creates accounts that way.
select lives_ok(
  $$
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values (
      'a1000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'magiclink@example.test',
      null, now(),
      '{"provider":"email","providers":["email"]}',
      '{"company_name":"Magic Co","full_name":"Magic Person"}',
      now(), now()
    )
  $$,
  'a passwordless magic-link account is created'
);

select is_empty(
  $$
    select 1 from public.tenants where name = 'Magic Co'
    union all
    select 1 from public.users where id = 'a1000000-0000-0000-0000-000000000005'
  $$,
  'a passwordless account founds no company and gets no access'
);

-- 4. The founder. On a database with no company at all, the first self-signup is
--    the one that is allowed, because somebody has to be.
truncate public.tenants cascade;

select lives_ok(
  $$
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values (
      'a1000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'founder@example.test',
      crypt('Password123!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      '{"company_name":"Founding Company","full_name":"First Person"}',
      now(), now()
    )
  $$,
  'the first self-signup on an empty deployment is allowed'
);

select results_eq(
  $$
    select t.name, u.power_level::text
    from public.users u
    join public.tenants t on t.id = u.tenant_id
    where u.id = 'a1000000-0000-0000-0000-000000000003'
  $$,
  $$values ('Founding Company'::text, 'super_admin'::text)$$,
  'the founder gets their company and is its Super Admin'
);

-- And the door shuts behind them: the second person cannot repeat the trick.
select throws_ok(
  $$
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values (
      'a1000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'second@example.test',
      crypt('Password123!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      '{"company_name":"Second Company","full_name":"Second Person"}',
      now(), now()
    )
  $$,
  '42501',
  'Signing yourself up is closed on this deployment. Ask an administrator to invite you.',
  'the door shuts behind the founder'
);

select * from finish();

rollback;
