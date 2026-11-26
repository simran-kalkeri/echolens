import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/shell/app-shell";

export const metadata: Metadata = {
  title: { default: "EchoLens", template: "%s · EchoLens" },
  description: "Customer feedback intelligence: taxonomy, trends, emerging issues and an AI analyst with cited evidence.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
