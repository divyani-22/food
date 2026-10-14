import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";

/**
 * onnxruntime-web needs its .wasm binaries at runtime. They live in node_modules, so instead of committing
 * ~40 MB of binaries we serve them from a stable path (/ort/<file>) in `vite` dev and emit them into the
 * production build. The app fetches them itself (see client/src/lib/onDeviceEngine.ts), caches them in the
 * Cache API and hands them to ORT as `env.wasm.wasmBinary`, so no .mjs loader or cross-origin isolation
 * (COOP/COEP) is needed: single-threaded wasm only.
 */
function ortWasmAssets(): Plugin {
  const distDir = path.resolve(import.meta.dirname, "node_modules", "onnxruntime-web", "dist");
  // wasm-only runtime (~14 MB) and the WebGPU-capable runtime (~28 MB); the app picks one at runtime.
  const files = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.jsep.wasm"];
  return {
    name: "ort-wasm-assets",
    configureServer(server) {
      server.middlewares.use("/ort", (req, res, next) => {
        const name = decodeURIComponent((req.url ?? "").split("?")[0].replace(/^\//, ""));
        if (!files.includes(name)) return next();
        const file = path.join(distDir, name);
        if (!fs.existsSync(file)) return next();
        res.setHeader("Content-Type", "application/wasm");
        res.setHeader("Content-Length", String(fs.statSync(file).size));
        res.setHeader("Cache-Control", "no-cache");
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const name of files) {
        const file = path.join(distDir, name);
        if (!fs.existsSync(file)) {
          this.error(`onnxruntime-web asset missing: ${file} (run the package install first)`);
        }
        this.emitFile({ type: "asset", fileName: `ort/${name}`, source: fs.readFileSync(file) });
      }
    },
  };
}

const plugins = [react(), tailwindcss(), ortWasmAssets()];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  optimizeDeps: {
    // Already a pre-built bundle; pre-bundling it again only slows dev start and triggers a mid-session reload.
    exclude: ["onnxruntime-web", "onnxruntime-web/wasm"],
  },
  worker: {
    format: "es",
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
