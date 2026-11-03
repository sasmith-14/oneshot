/// <reference types="vitest/config" />
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The JSON API owns root paths (/actions, /system/status, ...), so the console
// lives under /ui/ both here and when FastAPI serves the built files.
const API = process.env.ONESHOT_API ?? "http://127.0.0.1:8700";
const API_PREFIXES = ["/actions", "/action-types", "/system", "/reconcile", "/healthz", "/lab", "/guarantees", "/learn"];

export default defineConfig({
  base: "/ui/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(API_PREFIXES.map((p) => [p, { target: API, changeOrigin: true }])),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
