import type { Metadata } from "next";
import React from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/wallet/Providers";

const APP_URL = "https://baseguardian.rakibhq.xyz";
const BASE_APP_ID = "693acb1de6be54f5ed71d631";
// Keep the filename versioned so social crawlers fetch a fresh card after updates.
const SOCIAL_IMAGE_URL = `${APP_URL}/base-guardian-x-card-v2.png`;
const DESCRIPTION = "Wallet intelligence and onchain security for Base.";
const SOCIAL_IMAGE_ALT = "Base Guardian — Wallet intelligence and onchain security for Base";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: "Base Guardian",
  description: DESCRIPTION,
  alternates: {
    canonical: APP_URL,
  },

  openGraph: {
    title: "Base Guardian",
    description: DESCRIPTION,
    url: APP_URL,
    siteName: "Base Guardian",
    locale: "en_US",
    images: [
      {
        url: SOCIAL_IMAGE_URL,
        secureUrl: SOCIAL_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: SOCIAL_IMAGE_ALT,
        type: "image/png",
      },
    ],
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "Base Guardian",
    description: DESCRIPTION,
    images: [{ url: SOCIAL_IMAGE_URL, alt: SOCIAL_IMAGE_ALT }],
  },

  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },

  other: {
    "base:app_id": BASE_APP_ID,
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
