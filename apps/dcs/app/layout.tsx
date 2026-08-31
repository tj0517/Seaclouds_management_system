import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "SCL DCS",
  description: "Document Control System — Sea Clouds",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
