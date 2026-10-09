import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `next dev` serves its HMR endpoint only to the origin it was started as. Opening
  // the app at the loopback IP is common here, and without this the dev client is
  // refused its own resources — the page renders but never hydrates.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
  turbopack: {
    rules: {
      // ThreeUI's shader sources are authored HTML documents pulled in as strings
      // (`import source from "./sources/x.html?raw"`). The query condition keeps this
      // rule off every other .html file in the project.
      '*.html': {
        condition: { query: /[?&]raw(?:[=&]|$)/ },
        loaders: ['raw-loader'],
        as: '*.js',
      },
    },
  },
};

export default nextConfig;
