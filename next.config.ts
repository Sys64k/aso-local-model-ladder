import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.APP_VERSION || pkg.version,
  },
};

export default nextConfig;
