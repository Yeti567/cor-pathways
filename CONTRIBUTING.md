# Contributing

Bug reports and fixes are welcome. This is a small project maintained by one
person, so please read the two short sections below before opening a pull request.

## Before you start

For anything beyond a small fix, open an issue first. This app is shaped by how
COR and NSC audits actually get scored, and a change that looks like an
improvement can quietly break the evidence trail an auditor expects. It is better
to find that out in an issue than after you have written the code.

## Ground rules

**Never commit real data.** Not a screenshot of your live console, not a database
dump, not a form with a worker's name on it. Working screenshots of real workers,
complete with their personal phone numbers, were tracked in this repo by accident
for months. Use the local seed fixtures (`supabase/seed.sql`) for anything you need
to show; the root `.gitignore` now blocks stray images.

**Row level security is not access control on its own.** If you add a table, it
needs a table privilege as well as a policy, or PostgREST returns
`permission denied` however permissive your policy is. `ALTER DEFAULT PRIVILEGES`
at the end of the schema covers new tables created by migrations;
`tests/schema-rls.test.ts` fails if that protection is removed.

**Every tenant-scoped table needs `tenant_id`, RLS, and a policy that consults
`is_tenant_member`.** Add the table to the list in `tests/schema-rls.test.ts`. If
it is not in that list, nothing checks it.

**Do not add a paywall.** No trial clock, no plan gate, no billing check. The
per-tenant module toggles are product configuration and are a different thing; if
you are unsure which you are writing, open an issue.

## Schema changes

The schema is one baseline file, `supabase/migrations/20260716000000_initial_schema.sql`.
Add a new timestamped migration on top of it rather than editing the baseline, and
give it a version no other migration uses. Two migrations sharing a version aborts
the run, and because Supabase records the version and not the filename, the loser
can be silently skipped as "already applied" and never run at all.

Test it against an empty database before you send it, because that is the case that
breaks:

```bash
supabase db reset
supabase test db supabase/tests/tenant-isolation.sql
```

## Checks

Green before you open a PR:

```bash
npm test
npm run lint
npx tsc --noEmit
```

## Licence

Contributions are accepted under [AGPL-3.0-or-later](LICENSE), the same licence as
the project.
