# Cor Pathways

Field safety and compliance software for trades, contractors, and carriers. Forms
that work offline in the dirt, COR audit readiness mapped to your certifying
partner, service work orders, equipment and maintenance, NSC transport, and live
ELD data. One app instead of a binder and three subscriptions.

It is free, and it is yours. You run it on your own Vercel project, your own
Supabase database, your own API keys. There is no trial, no per-user fee, no plan
that hides a module behind an upgrade button, and no vendor who can switch it off.

If you want someone to build your safety program inside it and keep it current,
that is the paid part: <https://corpathway360.com>.

## What you need

- A [Supabase](https://supabase.com) project. Free tier is enough for a small crew.
- Somewhere to host it. [Vercel](https://vercel.com) is the path of least
  resistance; anywhere that runs Next.js works.
- Node 20+ if you want to run it locally.

Supabase is the only requirement. Everything else (PDF form import, outbound
email, ELD) switches on when you add that service's key, and is simply absent when
you do not.

## Set it up

**1. Create a Supabase project.** Note the project URL and keys from
Project Settings > API.

**2. Create the database.** Install the
[Supabase CLI](https://supabase.com/docs/guides/local-development), then:

```bash
git clone https://github.com/YOUR-USERNAME/cor-pathways.git
cd cor-pathways
npm install
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

That applies `supabase/migrations/20260716000000_initial_schema.sql`, which is the
entire database: every table, every row level security policy, the storage buckets,
and the trigger that builds a company's first tenant on signup.

**3. Configure auth.** In the Supabase dashboard, under
Authentication > URL Configuration, set your site URL and add
`https://your-app-domain.com/auth/confirm` as a redirect URL. Skipping this sends
your users' confirmation emails to the wrong place. (`supabase/config.toml`
configures your *local* machine only; it does not touch a hosted project.)

**4. Set environment variables.** Copy `.env.example` to `.env.local` and fill in
the Supabase section. Every variable is documented in that file, including which
ones are optional and what turns off without them.

**5. Deploy.** Point Vercel at your fork and add the same environment variables in
the project settings. Or run it locally:

```bash
npm run dev
```

**6. Sign up.** The first account you create becomes the Super Admin, and the
signup builds your company with four permission profiles, eight starter forms, and
five managed lists ready to edit.

## Running it locally

```bash
supabase start   # local Postgres, auth, and storage in Docker
npm run dev
```

`supabase start` applies the schema and loads `supabase/seed.sql`: two demo
companies and a login for every permission level, all with the password
`Password123!`. Reset it any time with `supabase db reset`.

## Development

```bash
npm run dev                  # dev server
npm test                     # unit tests
npm run lint                 # eslint
npx tsc --noEmit             # typecheck
npm run test:e2e             # playwright
supabase test db supabase/tests/tenant-isolation.sql   # tenant isolation, against a real database
```

## How it is put together

Next.js App Router, Supabase Postgres, Tailwind. Installs as a PWA and works
offline: submissions, photos, and signatures queue in IndexedDB and sync when
signal returns.

Multi-tenant, with `tenant_id` on 83 tables behind row level security. Self-hosting
means one company in your database, so the tenant plumbing is just a constant you
can ignore.

Two things worth knowing before you change the schema:

- **Row level security decides which rows a user sees. It does not grant access to
  a table.** Without a table privilege, PostgREST answers `permission denied` no
  matter how permissive your policies are. `ALTER DEFAULT PRIVILEGES` at the end of
  the schema handles new tables; `tests/schema-rls.test.ts` fails if that breaks.
- **The module toggles are not a paywall.** `transport_enabled`, `cor_enabled`, and
  the rest are product configuration, set per company in Admin > Setup. Everything
  is available to everyone; the toggles just decide what you want cluttering your
  nav.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## Licence

[AGPL-3.0-or-later](LICENSE).

In plain terms: run it for your own company, forever, free, and change whatever you
like. If you run a modified version *as a service for other people*, you have to
publish your changes under the same licence. Using it to run your own business is
never affected by that.

The COR program content (policies, procedures, and forms written and mapped to a
certifying partner's audit) is not part of this repository and is not covered by
this licence.
