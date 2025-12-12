/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/",
        destination: "/?v=2",
        permanent: false, // keep false while testing
      },
    ];
  },
};

export default nextConfig;
