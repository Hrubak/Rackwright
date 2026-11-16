import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// RW_API points web dev mode at another server, e.g. RW_API=http://10.0.0.5:8080 npm run dev:web
const api = process.env.RW_API || "http://127.0.0.1:8080";
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420, strictPort: true,
    // Web dev mode: forward API calls to the Rust server.
    proxy: mode === "web" ? { "/api": { target: api, changeOrigin: true }, "/healthz": { target: api, changeOrigin: true } } : undefined,
  },
}));
