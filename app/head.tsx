export default function Head() {
  const frame = {
    version: "next",
    imageUrl: "https://baseguardian.vercel.app/preview.png",
    button: {
      title: "Open Base Guardian",
      action: {
        type: "launch_frame",
        url: "https://baseguardian.vercel.app/",
      },
    },
  };

  const content = JSON.stringify(frame);

  return (
    <>
      {/* Required for Base mini apps verification */}
      <meta name="base:app_id" content="693acb1de6be54f5ed71d631" />

      {/* Add BOTH for maximum compatibility */}
      <meta name="fc:frame" content={content} />
      <meta name="fc:miniapp" content={content} />

      {/* Optional but good */}
      <meta property="og:title" content="Base Guardian" />
      <meta property="og:description" content="Wallet health & security on Base." />
      <meta property="og:image" content="https://baseguardian.vercel.app/preview.png" />
    </>
  );
}
