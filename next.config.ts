import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Google Books cover images (used by enrichment pipeline)
      { protocol: 'https', hostname: 'books.google.com' },
      // Open Library cover images
      { protocol: 'https', hostname: 'covers.openlibrary.org' },
    ],
  },
};

export default nextConfig;
