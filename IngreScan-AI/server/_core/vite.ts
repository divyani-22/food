import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express, distPathOverride?: string) {
  const distPath =
    distPathOverride ??
    (process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public"));
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html for client-side routes only. API calls, non-GET requests and requests for a file
  // (a missing hashed chunk, a stale .js/.wasm) must 404 instead of receiving HTML with status 200: browsers would
  // otherwise try to execute/parse index.html as a script and cache the error page under the asset URL.
  app.use("*", (req, res) => {
    const urlPath = req.originalUrl.split("?")[0];
    if (urlPath === "/api" || urlPath.startsWith("/api/")) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    if (/\.(?!html?$)[a-z0-9]{1,8}$/i.test(urlPath)) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
