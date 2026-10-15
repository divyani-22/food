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
import { sdk } from "./sdk";
import { serveStatic, setupVite } from "./vite";
import { registerWhatsappRoutes, startReminderScheduler } from "../whatsappRuntime";
import { createRateLimiter } from "./rateLimit";
import { assertRuntimeConfig } from "./env";
import { initDatabase } from "./database";
import { registerUploadRoutes, registerSignedInStaticUploads, sessionUserId } from "../uploads";
import {
  configureTrustProxy,
  mountBodyParsers,
  optionsFromEnv,
  sameOriginGuard,
  securityHeaders,
  warnIfProxyMisconfigured,
} from "../lib/security";
import {
  errorHandler,
  initErrorReporting,
  installProcessHandlers,
  log,
  registerHealthRoutes,
  requestLogger,
} from "../lib/observability";

const FRESHGUARD_DETECT_MAX_BYTES = 10 * 1024 * 1024;

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
  assertRuntimeConfig();
  // Opens the database; for embedded SQLite this also applies pending migrations (fails fast on error).
  await initDatabase();
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  configureTrustProxy(app);
  await initErrorReporting();
  const healthState = { shuttingDown: false };
  // Request id + structured access log + security headers + health probes come first so they cover every route.
  app.use(requestLogger());
  app.use(securityHeaders(optionsFromEnv()));
  registerHealthRoutes(app, healthState);
  app.use(warnIfProxyMisconfigured(app, msg => log("warn", "proxy_config", { hint: msg })));
  app.use(sameOriginGuard((process.env.ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean)));
  // WhatsApp webhooks need the exact raw request bytes for signature checks, so they are mounted
  // BEFORE the JSON/urlencoded body parsers below.
  registerWhatsappRoutes(app);
  // Whole-shelf detection uploads one photo; refuse anything over 10 MB before the 50 MB parser buffers it.
  app.use("/api/freshguard/detect", (req, res, next) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > FRESHGUARD_DETECT_MAX_BYTES) {
      res.status(413).json({ error: "Image is too large (10 MB maximum)." });
      return;
    }
    next();
  });
  // Per-route JSON limits (tRPC 24 MB for base64 photos, FreshGuard proxy 15 MB, everything else 1 MB).
  mountBodyParsers(app);
  const apiLimiter = createRateLimiter({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_API_PER_MIN) || 600 });
  const authLimiter = createRateLimiter({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_AUTH_PER_MIN) || 60 });
  const uploadsLimiter = createRateLimiter({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_UPLOADS_PER_MIN) || 600 });
  // Per-user budget for LLM-backed / third-party-backed procedures (the per-IP limiter above is shared by NAT users and
  // bypassable by rotating addresses). Keyed on the signed session's openId; falls back to the IP when anonymous.
  const EXPENSIVE = /(^|[/,])(chat\.sendMessage|analysis\.[A-Za-z]+|scanner\.processOCR|receipt\.parse|rescue\.recipes|openFoodFacts\.[A-Za-z]+)(?=[,?]|$)/;
  const expensiveLimiter = createRateLimiter({
    windowMs: 60_000,
    max: Number(process.env.RATE_LIMIT_LLM_PER_MIN) || 30,
    keyFn: req => (req as any).__rlUser ?? null,
  });
  app.use("/api/trpc", async (req, res, next) => {
    if (!EXPENSIVE.test(req.path)) return next();
    try {
      const m = /(?:^|;\s*)app_session_id=([^;]+)/.exec(req.headers.cookie ?? "");
      const session = m ? await sdk.verifySession(decodeURIComponent(m[1])) : null; // signature-checked: cannot be forged for fresh buckets
      if (session) (req as any).__rlUser = "u:" + session.openId;
    } catch {
      /* anonymous: IP key */
    }
    expensiveLimiter(req, res, next);
  });
  // OAuth callback under /api/oauth/callback
  app.use("/api/oauth", authLimiter);
  registerOAuthRoutes(app);
  // Scan/label photos: same /uploads/<name> URLs as before, but only the owner (signed-in) can read them.
  app.use("/uploads", uploadsLimiter);
  registerUploadRoutes(app, { getUserId: sessionUserId });

  // FreshGuard Static and API Integration
  const freshguardStaticDir = path.resolve(process.cwd(), "..", "static");
  if (fs.existsSync(freshguardStaticDir)) {
    // Produce photos saved by the Flask service require a signed-in session; samples/css/vendor stay public.
    registerSignedInStaticUploads(
      app,
      ["/static", "/freshguard/static"],
      path.join(freshguardStaticDir, "uploads"),
      sessionUserId
    );
    app.use("/static", express.static(freshguardStaticDir));
    app.use("/freshguard/static", express.static(freshguardStaticDir));
  }

  const freshguardLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });
  // Detection runs a detector plus one classifier pass per item, so it gets a tighter budget.
  const freshguardDetectLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
  app.use("/api/freshguard/detect", freshguardDetectLimiter);
  app.all("/api/freshguard/*", freshguardLimiter, async (req, res) => {
    try {
      // Only signed-in users may reach the FreshGuard backend (same auth as tRPC).
      const { user } = await createContext({ req, res } as any);
      if (!user) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }

      // Only the stateless classification endpoints are reachable from the web app. Pantry and history
      // are stored per user in the app database (tRPC "produce" router), never in the Flask service's shared SQLite.
      const parsed = new URL(req.url.replace(/^\/api\/freshguard/, "/api"), "http://internal");
      const route = parsed.pathname.replace(/\/+$/, "");
      const allowed =
        (req.method === "POST" && (route === "/api/predict" || route === "/api/detect")) ||
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
        // Never let a hung Flask worker pin the request (and its buffered body) forever.
        signal: AbortSignal.timeout(Number(process.env.FRESHGUARD_TIMEOUT_MS) || 60_000),
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
      if (err?.name === "TimeoutError" || err?.name === "AbortError") {
        res.status(504).json({ error: "FreshGuard AI backend timed out." });
        return;
      }
      res.status(502).json({ error: "FreshGuard AI backend is unavailable.", details: err.message });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    apiLimiter,
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
  // Must be last: turns thrown/forwarded errors into safe JSON/text without leaking internals.
  app.use(errorHandler());

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  let stopReminders: (() => void) | null = null;
  installProcessHandlers({ server, state: healthState, onShutdown: () => stopReminders?.() });
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    log("info", "server_started", { port, env: process.env.NODE_ENV ?? "unset" });
    stopReminders = startReminderScheduler();
  });
}

startServer().catch(err => {
  console.error("[Startup] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
