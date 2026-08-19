import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/brand";

// Launchers truncate the label under a home-screen icon at roughly twelve
// characters. A client name like "Crude Master Transport Inc." would render as
// "Crude Mast...", so keep whole leading words while they fit.
function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  let out = words[0] ?? name;

  for (const word of words.slice(1)) {
    if (`${out} ${word}`.length > 12) {
      break;
    }
    out = `${out} ${word}`;
  }

  return out;
}

// The manifest used to be a static file in public/, which meant every phone
// that installed a client deployment got an app named "Core Pathways" no
// matter whose branding the deployment carried. Built here instead, it reads
// the same NEXT_PUBLIC_APP_NAME the rest of the product brands itself with.
//
// The PNG icons exist because Chrome's installability check wants real raster
// icons at 192 and 512; with only the SVG, beforeinstallprompt never fired on
// some Android devices and the install banner had nothing to offer.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: shortName(APP_NAME),
    description: `${APP_NAME} offline worker app.`,
    start_url: "/web",
    scope: "/",
    display: "standalone",
    background_color: "#f7f9fb",
    theme_color: "#0f766e",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
