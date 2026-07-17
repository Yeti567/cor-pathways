import Image from "next/image";
import {
  parseAddressLines,
  shouldShowCompanyInfo,
  shouldShowLogo,
  type CompanySettingsRow,
  type PrintSettingsRow,
} from "@/lib/company-settings";

type PrintHeaderProps = {
  className?: string;
  companySettings: CompanySettingsRow | null;
  logoUrl: string | null;
  mode?: "always" | "print-only";
  printSettings: PrintSettingsRow | null;
  tenantName: string;
};

function cleanText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function companyInfoLines(companySettings: CompanySettingsRow | null) {
  const addressLines = parseAddressLines(companySettings?.address);
  const phone = cleanText(companySettings?.phone);
  const companyId = cleanText(companySettings?.company_id);

  return [
    ...addressLines,
    phone ? `Phone: ${phone}` : null,
    companyId ? `Company ID: ${companyId}` : null,
  ].filter((line): line is string => Boolean(line));
}

export function PrintHeader({
  className = "",
  companySettings,
  logoUrl,
  mode = "print-only",
  printSettings,
  tenantName,
}: PrintHeaderProps) {
  const headerOption = printSettings?.header_option ?? "company_info_only";
  const logoPlacement = printSettings?.logo_placement ?? "left";
  const companyName = cleanText(companySettings?.company_name) || tenantName;
  const infoLines = companyInfoLines(companySettings);
  const showInfo = shouldShowCompanyInfo(headerOption);
  const showLogo = Boolean(logoUrl && shouldShowLogo(headerOption));
  const infoAlignment = showLogo ? (logoPlacement === "left" ? "text-right" : "text-left") : "text-center";

  if (!showInfo && !showLogo) {
    return null;
  }

  const logo = showLogo ? (
    <div className="flex h-16 w-40 shrink-0 items-center justify-center">
      <Image
        alt={`${companyName} logo`}
        className="max-h-16 w-auto object-contain"
        height={64}
        src={logoUrl ?? ""}
        unoptimized
        width={160}
      />
    </div>
  ) : null;

  return (
    <header
      className={`${mode === "print-only" ? "hidden print:block" : "block"} border-b border-[var(--border)] pb-4 print:border-gray-300 print:text-black ${className}`}
    >
      <div
        className={`flex items-start gap-4 ${
          showInfo ? "justify-between" : logoPlacement === "right" ? "justify-end" : "justify-start"
        }`}
      >
        {showLogo && logoPlacement === "left" ? logo : null}
        {showInfo ? (
          <div className={`min-w-0 flex-1 ${infoAlignment}`}>
            <p className="text-base font-bold leading-5">{companyName}</p>
            {infoLines.map((line) => (
              <p className="mt-0.5 text-xs leading-4 text-gray-700" key={line}>
                {line}
              </p>
            ))}
          </div>
        ) : null}
        {showLogo && logoPlacement === "right" ? logo : null}
      </div>
    </header>
  );
}
