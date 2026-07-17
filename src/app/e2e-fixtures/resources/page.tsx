import { notFound } from "next/navigation";
import { ResourceLibraryPanel } from "@/app/web/_components/ResourceLibraryPanel";
import type { OfflineResourceSectionSummary, OfflineResourceSummary } from "@/lib/offline/resources";

export const dynamic = "force-dynamic";

type ResourceFixturePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function fixtureId(value: string | undefined) {
  return value?.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 48) || "default";
}

export default async function ResourceFixturePage({ searchParams }: ResourceFixturePageProps) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const runId = fixtureId(firstParam(params.run));
  const tenantId = `tenant-${runId}`;
  const downloadPath = `/e2e-fixtures/resources/resource-download?run=${encodeURIComponent(runId)}`;
  const sections: OfflineResourceSectionSummary[] = [
    {
      id: `policies-${runId}`,
      name: "Policies",
      sortOrder: 100,
      tenantId,
    },
    {
      id: `procedures-${runId}`,
      name: "Procedures",
      sortOrder: 200,
      tenantId,
    },
  ];
  const resources: OfflineResourceSummary[] = [
    {
      bodyText: null,
      dcn: "ACME-POL-0002",
      id: `policy-${runId}`,
      mimeType: "application/pdf",
      name: "Company Policy",
      sectionId: sections[0].id,
      signedUrl: `${downloadPath}&file=company-policy`,
      sortOrder: 100,
      storagePath: `${tenantId}/resources/company-policy.pdf`,
      tenantId,
      updatedAt: "2026-05-22T09:00:00.000Z",
    },
    {
      bodyText: null,
      dcn: "ACME-PRC-0001",
      id: `working-alone-${runId}`,
      mimeType: "application/pdf",
      name: "Working Alone Procedure",
      sectionId: sections[1].id,
      signedUrl: `${downloadPath}&file=working-alone`,
      sortOrder: 100,
      storagePath: `${tenantId}/resources/working-alone.pdf`,
      tenantId,
      updatedAt: "2026-05-22T10:00:00.000Z",
    },
    {
      bodyText: null,
      dcn: "ACME-MAN-0003",
      id: `orientation-${runId}`,
      mimeType: "application/pdf",
      name: "Orientation Manual",
      sectionId: null,
      signedUrl: null,
      sortOrder: 300,
      storagePath: `${tenantId}/resources/orientation-manual.pdf`,
      tenantId,
      updatedAt: "2026-05-21T10:00:00.000Z",
    },
  ];

  return (
    <main className="min-h-screen bg-[var(--background)] p-4">
      <ResourceLibraryPanel
        initialResources={resources}
        initialSections={sections}
        offlineSyncDays={14}
        referenceSearch=""
        tenantId={tenantId}
      />
    </main>
  );
}
