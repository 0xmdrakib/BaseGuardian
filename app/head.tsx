// app/head.tsx
export default function Head() {
  return (
    <>
      <title>Base Guardian</title>

      {/* 👇 THIS is what Base is complaining about */}
      <meta name="base:app_id" content="app_YOUR_REAL_APP_ID_HERE" />

      {/* Mini app preview in casts */}
      <meta
        name="fc:miniapp"
        content={JSON.stringify({
          version: "next",
          imageUrl: "https://baseguardian.vercel.app/splash.png", // or /preview.png, whatever you used
          button: {
            title: "Open Base Guardian",
            action: {
              type: "launch_frame",
              url: "https://baseguardian.vercel.app/",
            },
          },
        })}
      />
    </>
  );
}
