import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // tesseract.js spawns a Node worker that resolves its own worker-script path
  // from node_modules at runtime; bundling it mangles that path (MODULE_NOT_FOUND
  // for src/worker-script/node/index.js) and the OCR worker hangs forever. Keep it
  // (and its core) external so the paths resolve correctly. @napi-rs/canvas is a
  // native addon that must also stay external.
  serverExternalPackages: ["@napi-rs/canvas", "tesseract.js", "tesseract.js-core"],
  // The Setup page's production-readiness checks read migration files and
  // vercel.json from disk at request time; trace them into the route bundle so
  // the checks are accurate in the deployed serverless function.
  outputFileTracingIncludes: {
    "/admin/setup": ["./supabase/migrations/**", "./vercel.json"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(self), microphone=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
