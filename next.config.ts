import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a minimal self-contained server (.next/standalone/server.js) that the Electron shell runs.
  output: "standalone",
  // Keep the native SQLite addon out of the server bundle so it's required from node_modules at
  // runtime (where the Electron-ABI binary lives), not inlined by the bundler.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
