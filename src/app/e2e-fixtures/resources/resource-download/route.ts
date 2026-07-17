function pdfBody(title: string) {
  return [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >> endobj",
    `4 0 obj << /Length 72 >> stream\nBT /F1 12 Tf 32 96 Td (${title}) Tj ET\nendstream endobj`,
    "xref",
    "0 5",
    "0000000000 65535 f ",
    "trailer << /Root 1 0 R /Size 5 >>",
    "startxref",
    "0",
    "%%EOF",
  ].join("\n");
}

export function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }

  const url = new URL(request.url);
  const file = url.searchParams.get("file") === "working-alone" ? "Working Alone Procedure" : "Company Policy";

  return new Response(pdfBody(file), {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `inline; filename="${file.replace(/\s+/g, "-").toLowerCase()}.pdf"`,
      "content-type": "application/pdf",
    },
  });
}
