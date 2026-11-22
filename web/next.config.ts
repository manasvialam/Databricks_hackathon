import type { NextConfig } from "next";

const config: NextConfig = {
  // standalone output is what the Databricks App runs, and is also fine on Vercel
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // the snapshot JSON is read from disk at runtime, so make sure it ships with the server bundle
  outputFileTracingIncludes: { "/api/**": ["./data/**/*"] },
};

export default config;
