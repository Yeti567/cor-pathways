import type { Metadata, Viewport } from "next";
import { InstallBanner } from "@/app/_components/InstallBanner";
import { OfflineRuntime } from "@/app/_components/OfflineRuntime";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cor Pathways Operations",
  description: "A multi-tenant offline-first operations platform.",
  manifest: "/manifest.webmanifest",
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
