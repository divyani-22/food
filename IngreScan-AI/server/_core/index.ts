import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import fs from "fs";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { createRateLimiter } from "./rateLimit";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Static uploads directory
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use("/uploads", express.static(uploadsDir));

  // FreshGuard Static and API Integration
  const freshguardStaticDir = path.resolve(process.cwd(), "..", "static");
  if (fs.existsSync(freshguardStaticDir)) {
    app.use("/static", express.static(freshguardStaticDir));
    app.use("/freshguard/static", express.static(freshguardStaticDir));
  }

  const freshguardLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });
  app.all("/api/freshguard/*", freshguardLimiter, async (req, res) => {
    try {
      // Only signed-in users may reach the FreshGuard backend (same auth as tRPC).
      const { user } = await createContext({ req, res } as any);
      if (!user) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }

      // Only the stateless classification endpoints are reachable from the web app. Pantry and history
      // are stored per user in MySQL (tRPC "produce" router), never in the Flask service's shared SQLite.
      const parsed = new URL(req.url.replace(/^\/api\/freshguard/, "/api"), "http://internal");
      const route = parsed.pathname.replace(/\/+$/, "");
      const allowed =
        (req.method === "POST" && route === "/api/predict") ||
        (req.method === "GET" && (route === "/api/samples" || route === "/api/fruits"));
      if (!allowed) {
        res.status(404).json({ error: "Not found." });
        return;
      }
      if (route === "/api/predict") parsed.searchParams.set("persist", "0");
      const targetUrl = `${process.env.FRESHGUARD_URL ?? "http://127.0.0.1:5000"}${parsed.pathname}${parsed.search}`;

      const headers: Record<string, string> = {};
      if (req.headers["content-type"]) {
        headers["content-type"] = req.headers["content-type"] as string;
      }

      const options: RequestInit = {
        method: req.method,
        headers,
      };

      if (req.method !== "GET" && req.method !== "HEAD") {
        if (req.body && Object.keys(req.body).length > 0) {
          options.body = JSON.stringify(req.body);
          headers["content-type"] = "application/json";
        }
      }

      const response = await fetch(targetUrl, options);
      const data = await response.text();
      res.status(response.status);
      const contentType = response.headers.get("content-type");
      if (contentType) {
        res.setHeader("content-type", contentType);
      }
      res.send(data);
    } catch (err: any) {
      console.error("[FreshGuard Proxy Error]:", err.message);
      res.status(502).json({ error: "FreshGuard AI backend is unavailable.", details: err.message });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Unhandled Rejection]", reason);
});

startServer().catch(console.error);
