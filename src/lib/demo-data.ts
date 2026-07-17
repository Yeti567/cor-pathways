export const seededTenants = [
  {
    name: "Northwind Civil",
    slug: "northwind-civil",
  },
  {
    name: "Blue Ridge Fabrication",
    slug: "blue-ridge-fabrication",
  },
] as const;

export const foundationChecklist = [
  "Next.js App Router scaffolded with TypeScript.",
  "Supabase environment variables documented in .env.example.",
  "Tenant scoped schema spine created in a reproducible migration.",
  "Row Level Security policies generated for every tenant scoped table.",
  "Demo tenants, users, permission profiles, and locations seeded.",
  "Tenant helper and isolation tests added.",
] as const;
