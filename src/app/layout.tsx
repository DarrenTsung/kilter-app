import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";

export const metadata: Metadata = {
  title: "Kilter Randomizer",
  description: "Climb randomizer for the Kilter Board",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="h-[100dvh] antialiased">
        <main className="h-[calc(100%-3rem)] overflow-y-auto">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
