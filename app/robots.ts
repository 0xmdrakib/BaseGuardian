import type { MetadataRoute } from "next";

const APP_URL = "https://baseguardian.rakibhq.xyz";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    host: APP_URL,
  };
}
