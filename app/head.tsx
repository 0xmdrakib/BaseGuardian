export default function Head() {
  const content = JSON.stringify({
    version: "next",
    imageUrl: "https://baseguardian.vercel.app/preview.png",
    button: {
      title: "Open Base Guardian",
      action: {
        type: "launch_frame",
        url: "https://baseguardian.vercel.app/"
      }
    }
  });

  return (
    <>
      <title>Base Guardian</title>
      <meta name="fc:miniapp" content={content} />
      {/* keep this too if you want it here instead of metadata.other */}
      {/* <meta name="base:app_id" content="693acb1de6be54f5ed71d631" /> */}
    </>
  );
}
