# Security

## Reporting a vulnerability

Email **blake.safetyconsultant@gmail.com** with "SECURITY" in the subject. Please
do not open a public issue for a vulnerability.

Include what you did, what happened, and what you expected. A proof of concept
helps. You will get a reply within a few days. This is a small project, so please
be patient rather than assuming you were ignored.

Report it even if you are not sure it is exploitable. This app holds worker names,
certifications, medical records, and incident reports. The cost of a false alarm is
a few minutes; the cost of a quiet real one is somebody's private information.

## What self-hosting means for your security

Every install is somebody's own deployment, on their own Supabase project and their
own hosting. That has a consequence worth being blunt about:

**Nobody can patch your instance for you.** There is no central service to push a
fix to. When a security fix lands here, you have to merge it into your fork and
redeploy, or you stay vulnerable. Watch this repository for releases, or pay
someone to watch it for you.

Two things that are entirely yours to get right:

- **`SUPABASE_SERVICE_ROLE_KEY` bypasses row level security.** It is a server-only
  secret. If it reaches a browser, a log, or a public repo, every tenant's data is
  readable by whoever holds it. Rotate it in the Supabase dashboard if you suspect
  exposure.
- **Auth redirect URLs.** Set them in your Supabase dashboard, not just in
  `supabase/config.toml`, which only configures a local machine.

## Scope

In scope: authentication and session handling, tenant isolation and row level
security, the storage policies, privilege escalation between permission levels, and
anything that leaks one company's data to another.

Not in scope: findings that require an attacker to already hold the service role
key or a database superuser role, and vulnerabilities in Supabase, Vercel, or
Next.js themselves (report those upstream).

## Tenant isolation

Tenant isolation is enforced in the database, not in app code, via row level
security on 83 tables. It is verified by
`supabase/tests/tenant-isolation.sql`, which exercises the policies against a real
database:

```bash
supabase test db supabase/tests/tenant-isolation.sql
```

If you are auditing this app, start there and with `tests/schema-rls.test.ts`.
