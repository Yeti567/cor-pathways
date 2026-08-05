import type { Metadata, Viewport } from "next";
import { InstallBanner } from "@/app/_components/InstallBanner";
import { OfflineRuntime } from "@/app/_components/OfflineRuntime";
import "./globals.css";

export const metadata: Metadata = {
  title: "Core Pathways Operations",
  description: "A multi-tenant offline-first operations platform.",
  manifest: "/manifest.webmanifest",
  // The application is not a search destination. Marketing and content live on
  // corpathway360.com, and this host serves app.corpathway360.com plus the demo.
  // Two reasons this is set here rather than in a robots.txt: it covers every
  // route including the ones added later, and it keeps gated screens, which are
  // the majority of this app, out of the index where they are pure noise.
  //
  // Deploy this as part of moving the app to its own subdomain, not before. While
  // this host is still serving the apex, a noindex removes the apex from search
  // before the marketing site is there to replace it.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <OfflineRuntime />
        {children}
        <InstallBanner />
      </body>
    </html>
  );
}
