// app/head.tsx
export default function Head() {
  return (
    <>
      <title>Base Guardian</title>

      {/* REQUIRED for Base Build ownership check */}
      <meta
        name="base:app_id"
        content="693acb1de6be54f5ed71d631"
      />

      {/* Optional: Farcaster mini app preview */}
      <meta
        name="fc:miniapp"
        content={JSON.stringify({
          version: "next",
          imageUrl: "https://baseguardian.vercel.app/preview.png",
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
