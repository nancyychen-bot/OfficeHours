import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the file-tracing root to this project — the home dir has a stray
  // package-lock.json (unrelated git repo) that Next would otherwise pick.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  async headers() {
    return [
      {
        source: "/add-event",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors https://*.notion.so https://notion.so https://*.notion.site",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
