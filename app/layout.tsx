import type { Metadata } from "next";
import React from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/wallet/Providers";

const APP_URL = "https://baseguardian.rakibhq.xyz";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: "Base Guardian",
  description: "Wallet health and security checks on Base.",

  openGraph: {
    title: "Base Guardian",
    description: "Wallet health and security checks on Base.",
    url: APP_URL,
    images: [
      { url: "/preview.png", width: 1200, height: 630, alt: "Base Guardian" },
    ],
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "Base Guardian",
    description: "Wallet health and security checks on Base.",
    images: ["/preview.png"],
  },

  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },

};

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
