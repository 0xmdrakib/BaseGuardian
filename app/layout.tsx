import type { Metadata } from "next";
import React from "react";
import { Inter } from "next/font/google";
import "./globals.css";

const APP_URL = "https://baseguardian.vercel.app";
const APP_ID = "693acb1de6be54f5ed71d631"; // your app_id

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: "Base Guardian",
  description: "Wallet health & security mini app for Base.",

  openGraph: {
    title: "Base Guardian",
    description: "Wallet health & security mini app for Base.",
    url: APP_URL,
    images: [
      { url: "/preview.png", width: 1200, height: 630, alt: "Base Guardian" },
    ],
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "Base Guardian",
    description: "Wallet health & security mini app for Base.",
    images: ["/preview.png"],
  },

  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },

  other: {
    // ✅ Base verification
    "base:app_id": APP_ID,

    // ✅ Makes Warpcast/Base show "Open Base Guardian"
    "fc:miniapp": JSON.stringify({
      version: "1",
      imageUrl: `${APP_URL}/embed.png`,
      button: {
        title: "Open Base Guardian",
        action: {
          type: "launch_miniapp",
          name: "Base Guardian",
          url: APP_URL,
          splashBackgroundColor: "#020611",
        },
      },
    }),
    // Backward compatibility
    "fc:frame": JSON.stringify({
      version: "1",
      imageUrl: `${APP_URL}/embed.png`,
      button: {
        title: "Open Base Guardian",
        action: {
          type: "launch_frame",
          name: "Base Guardian",
          url: APP_URL,
          splashBackgroundColor: "#020611",
        },
      },
    }),
  },
};

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
