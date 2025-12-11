// app/layout.tsx
import type { Metadata } from "next";
import React from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Base Guardian",
  description: "Base wallet health & security mini app for Farcaster",
  other: {
    // 👇 THIS is what Base is looking for
    "base:app_id": "693acb1de6be54f5ed71d631",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-50">
        {children}
      </body>
    </html>
  );
}
