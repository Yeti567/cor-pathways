import type { Json } from "@/types/database";

function isRecord(value: Json): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function formatSubmissionValue(value: Json): string {
  if (value === null) {
    return "No answer";
  }

  if (typeof value === "string") {
    return value.trim() || "No answer";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const values = value
      .map((item) => formatSubmissionValue(item))
      .filter((item) => item !== "No answer");

    return values.length > 0 ? values.join(", ") : "No answer";
  }

  if (isRecord(value)) {
    if (value.type === "signature") {
      return typeof value.signerName === "string" && value.signerName.trim()
        ? `Signature: ${value.signerName.trim()}`
        : "Signature captured";
    }

    if (value.type === "photo") {
      return typeof value.fileName === "string" && value.fileName.trim()
        ? `Photo: ${value.fileName.trim()}`
        : "Photo captured";
    }

    if (value.type === "pdf") {
      return typeof value.fileName === "string" && value.fileName.trim()
        ? `PDF: ${value.fileName.trim()}`
        : "PDF attached";
    }

    if (value.type === "equipment") {
      const label =
        typeof value.unitNumber === "string" && value.unitNumber.trim()
          ? [value.unitNumber.trim(), typeof value.name === "string" ? value.name.trim() : ""].filter(Boolean).join(", ")
          : "Equipment selected";
      const meter =
        typeof value.meterReading === "string" || typeof value.meterReading === "number"
          ? `, meter ${String(value.meterReading).trim()}`
          : "";

      return `${label}${meter}`;
    }

    if (value.type === "gps" && typeof value.latitude === "number" && typeof value.longitude === "number") {
      return `${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}`;
    }
  }

  return JSON.stringify(value);
}
