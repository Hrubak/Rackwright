import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
// RW_API points web dev mode at another server, e.g. RW_API=http://10.0.0.5:8080 npm run dev:web
const api = process.env.RW_API || "http://127.0.0.1:8080";
// Web build only: put the PDF and picture reader files next to the app, so the server hands them out (/readers/…).
// The desktop build copies nothing; it loads the same pinned files from jsDelivr on first use.
function copyReaders(outDir: string) {
  const nm = (p: string) => path.resolve("node_modules", p);
  const copy = (from: string, to: string) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to); };
  const out = (p: string) => path.resolve(outDir, "readers", p);
  for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) copy(nm("pdfjs-dist/build/" + f), out("pdfjs/" + f));
  for (const f of ["tesseract.min.js", "worker.min.js"]) copy(nm("tesseract.js/dist/" + f), out("tesseract/" + f));
  for (const f of fs.readdirSync(nm("tesseract.js-core")).filter((n) => n.endsWith("lstm.wasm.js"))) copy(nm("tesseract.js-core/" + f), out("tesseract-core/" + f));
  copy(nm("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"), out("eng/eng.traineddata.gz"));
}
function copyReadersPlugin(): Plugin {
  let outDir = "dist";
  return {
    name: "copy-readers",
    apply: "build",
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    closeBundle() { copyReaders(outDir); },
  };
}
export default defineConfig(({ mode, command }) => ({
  plugins: [react(), ...(mode === "web" && command === "build" ? [copyReadersPlugin()] : [])],
  clearScreen: false,
  server: {
    port: 1420, strictPort: true,
    // Web dev mode: forward API calls to the Rust server.
    proxy: mode === "web" ? { "/api": { target: api, changeOrigin: true }, "/healthz": { target: api, changeOrigin: true } } : undefined,
  },
}));
