import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/brand";

// The label under a home-screen icon. Launchers truncate it, so a long legal name
// like "Crude Master Transport Inc." has to be shortened to whole leading words
// rather than cut mid-word.
//
// The bound is 16 rather than the launcher's own ~12, deliberately. At 12 a
// two-word company loses its second word entirely: "Speed Logistics" became
// "Speed" and "Northwind Energy Services" became "Northwind", which on a phone
// full of icons identifies nobody. A slightly truncated "Speed Logistics" is far
// easier to pick out than a bare first word that could belong to any app, so the
// second word is worth keeping even when the launcher clips its tail.
const SHORT_NAME_MAX = 16;

export function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  let out = words[0] ?? name;

  for (const word of words.slice(1)) {
    if (`${out} ${word}`.length > SHORT_NAME_MAX) {
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
