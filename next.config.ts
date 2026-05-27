import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Cloudflare R2 — self-hosted covers (primary, permanent)
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: 'pub-*.r2.dev' },
      // Google Books cover images (used by enrichment pipeline)
      { protocol: 'https', hostname: 'books.google.com' },
      // Open Library cover images
      { protocol: 'https', hostname: 'covers.openlibrary.org' },
      // Comic Vine covers (until migration complete)
      { protocol: 'https', hostname: 'comicvine.gamespot.com' },
    ],
  },
};

export default nextConfig;
