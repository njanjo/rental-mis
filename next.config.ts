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
};

export default nextConfig;
