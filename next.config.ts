import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The project lives inside a larger home directory that also has a
  // package-lock.json; pin the workspace root so Turbopack and tracing stay here.
  turbopack: {
    root: process.cwd(),
  },
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Baseline hardening for a finance-data app. X-Frame-Options and
        // frame-ancestors forbid clickjacking against the dashboard; a full
        // script CSP needs nonce plumbing through Next/Turbopack and is a
        // deliberate later step (docs/PHASE-8.md).
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // A 2 MB statement CSV plus the mapping fields exceeds the 1 MB default.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
