import { notFound } from "next/navigation";
import { PrintFooter } from "@/app/admin/_components/PrintFooter";
import { PrintHeader } from "@/app/admin/_components/PrintHeader";
import type { CompanySettingsRow, PrintSettingsRow } from "@/lib/company-settings";

export const dynamic = "force-dynamic";

const companySettings = {
  address: "123 Safety Way\nVancouver, BC",
  company_id: "COR-123",
  company_name: "Acme Safety Ltd.",
  phone: "604-555-0199",
} as CompanySettingsRow;

const basePrintSettings = {
  footer_note: "Controlled copy when printed from Cor Pathway 360.",
  header_option: "company_info_and_logo",
  logo_placement: "right",
  prepared_by_label: "Prepared for audit by",
  show_printed_at: true,
} as PrintSettingsRow;

const logoUrl =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='64' viewBox='0 0 160 64'%3E%3Crect width='160' height='64' fill='%230f766e'/%3E%3Ctext x='80' y='38' fill='white' font-size='20' font-family='Arial' text-anchor='middle'%3EACME%3C/text%3E%3C/svg%3E";

type PrintSettingsFixturePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PrintSettingsFixturePage({ searchParams }: PrintSettingsFixturePageProps) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const logoOnly = firstParam(params.mode) === "logo-only";
  const printSettings = logoOnly
    ? ({
        ...basePrintSettings,
        header_option: "logo_only",
        logo_placement: "left",
      } as PrintSettingsRow)
    : basePrintSettings;

  return (
    <main className="p-8">
      <PrintHeader
        companySettings={companySettings}
        logoUrl={logoUrl}
        printSettings={printSettings}
        tenantName="Acme Tenant"
      />
      <section>
        <h1 className="text-2xl font-bold text-[var(--ink)]">Operations trend report</h1>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">Printable report body</p>
      </section>
      <PrintFooter
        companySettings={companySettings}
        entries={[
          { label: "Report", value: "Operations trend report" },
          { label: "Date range", value: "01 Mar 2026 to 31 Mar 2026" },
        ]}
        generatedAt="2026-03-31T12:00:00.000Z"
        preparedByValue="Jordan Admin"
        printSettings={printSettings}
      />
    </main>
  );
}
