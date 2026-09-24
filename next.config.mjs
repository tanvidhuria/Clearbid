/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ["unpdf", "mammoth", "xlsx"] },
};
export default nextConfig;
