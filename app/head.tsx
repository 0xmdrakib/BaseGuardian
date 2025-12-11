// app/head.tsx
export default function Head() {
  return (
    <>
      <title>Base Guardian</title>
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
