/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{
        key: 'Permissions-Policy',
        value: 'local-network=(self), loopback-network=(self)',
      }],
    }];
  },
};
export default nextConfig;
