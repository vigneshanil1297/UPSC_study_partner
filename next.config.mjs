/** @type {import('next').NextConfig} */
const nextConfig = {
  // Essay images can be large; raise the Server Action / route body cap.
  experimental: {
    serverActions: { bodySizeLimit: "15mb" },
  },
};

export default nextConfig;
