import type { NextConfig } from "next";

// ── Content-Security-Policy (REPORT-ONLY) ─────────────────────────────────────
// This policy is NOT enforced — it is sent as `Content-Security-Policy-Report-Only`
// so violations are reported to /api/csp-report without blocking anything. It is
// the observation stage before an enforced CSP.
//
// Current allowances reflect the app as it runs today:
//   script-src 'unsafe-inline' 'unsafe-eval' — Next.js App Router injects inline
//     hydration/bootstrap scripts, and our JSON-LD is an inline <script>. Vercel
//     Analytics loads from va.vercel-scripts.com.
//   style-src 'unsafe-inline'  — Tailwind and React inline style attributes.
//   img-src https:             — cover images come from many retailer/CDN hosts.
//
// TO TIGHTEN LATER (before flipping to enforced Content-Security-Policy):
//   1. Replace script-src 'unsafe-inline' with a per-request nonce (needs a
//      Next middleware/proxy that injects the nonce into the CSP + scripts).
//   2. Drop 'unsafe-eval' once verified nothing at runtime needs it.
//   3. Narrow img-src from `https:` to the explicit cover hosts in next.config
//      images.remotePatterns.
//   4. Only after the Report-Only logs are clean for a week, rename the header
//      from *-Report-Only to Content-Security-Policy.
const cspReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
  "connect-src 'self' https://va.vercel-scripts.com https://vitals.vercel-insights.com",
  "report-uri /api/csp-report",
  "report-to csp-endpoint",
].join("; ");

// Static security headers applied to every response. HSTS is intentionally NOT
// set here — Vercel already sends Strict-Transport-Security at the edge.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Cloudflare R2 — self-hosted covers (primary, permanent)
      { protocol: 'https', hostname: 'images.catchcomics.com' },
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: 'pub-*.r2.dev' },
      // Google Books cover images (used by enrichment pipeline)
      { protocol: 'https', hostname: 'books.google.com' },
      // Open Library cover images
      { protocol: 'https', hostname: 'covers.openlibrary.org' },
      // Comic Vine covers (until migration complete)
      { protocol: 'https', hostname: 'comicvine.gamespot.com' },
      // Bookshop.org cover CDN — 190 products still on this domain pending R2 migration
      { protocol: 'https', hostname: 'images-eu.bookshop.org' },
    ],
  },
  async headers() {
    const headers = [...securityHeaders];

    // Ship the Report-Only CSP on every Vercel deployment — BOTH Preview and
    // Production — so it can be verified on a preview before it ever matters in
    // production. It is intentionally NOT sent during local `next dev`, where
    // Next's HMR / React Refresh legitimately use eval and would flood the
    // console with report noise.
    //
    // VERCEL_ENV is 'preview' or 'production' on Vercel deploys and undefined
    // locally. `headers()` is evaluated at build time, when VERCEL_ENV is set.
    // This header is Report-Only: it reports to /api/csp-report and blocks
    // nothing on any environment.
    const onVercelDeploy =
      process.env.VERCEL_ENV === "preview" ||
      process.env.VERCEL_ENV === "production";

    if (onVercelDeploy) {
      headers.push(
        { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
        { key: "Reporting-Endpoints", value: 'csp-endpoint="/api/csp-report"' },
      );
    }

    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
