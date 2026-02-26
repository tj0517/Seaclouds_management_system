import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Seaclouds Timesheet",
  description: "System zarządzania czasem pracy — Seaclouds",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
