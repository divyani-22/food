/**
 * HTTP hardening that needs no third-party package: security headers (helmet-equivalent), a CSP that fits the
 * built Vite app, same-origin enforcement for state-changing API calls, per-route JSON body limits, and
 * trust-proxy configuration. Everything is pure Express middleware so it can be tested on a real server.
 */
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";

export type CspMode = "enforce" | "report-only" | "off";

export type SecurityOptions = {
  /** Development uses Vite (inline preamble, websocket HMR): the full CSP is skipped there. */
  isDevelopment?: boolean;
  /** "report-only" (default) sends the full policy as Report-Only; the hard-boundary directives are always enforced. */
  cspMode?: CspMode;
  /** Extra origins appended to script-src / connect-src (comma separated env values, already split). */
  extraScriptSrc?: string[];
  extraConnectSrc?: string[];
  extraImgSrc?: string[];
};

function origin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map(s => s.trim()).filter(s => /^(https?:\/\/|wss?:\/\/)[^\s;,']+$/.test(s));
}

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): SecurityOptions {
  const mode = (env.CSP_MODE ?? "report-only").toLowerCase();
  const forge = origin(env.VITE_FRONTEND_FORGE_API_URL) ?? "https://forge.butterfly-effect.dev";
  return {
    isDevelopment: env.NODE_ENV === "development",
    cspMode: mode === "enforce" || mode === "off" ? (mode as CspMode) : "report-only",
    // Map.tsx loads the Maps JS bundle through the forge proxy.
    extraScriptSrc: [forge, ...list(env.CSP_EXTRA_SCRIPT_SRC)],
    extraConnectSrc: [forge, ...list(env.CSP_EXTRA_CONNECT_SRC)],
    extraImgSrc: list(env.CSP_EXTRA_IMG_SRC),
  };
}

/** Directives that cannot break a working page; always enforced. */
export function hardBoundaryCsp(): string {
  return ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");
}

/**
 * Full policy for the production app:
 *  - scripts only from this origin (+ 'wasm-unsafe-eval' for onnxruntime-web WebAssembly; no 'unsafe-eval'),
 *  - styles: Google Fonts stylesheet + inline styles (React style props / Radix),
 *  - fonts: Google Fonts files + bundled KaTeX/data fonts,
 *  - images: self, data:, blob: (camera / file previews) and https: (Open Food Facts product photos, map tiles),
 *  - workers: self + blob: (module worker for on-device inference, barcode decoding),
 *  - connect: self (tRPC, /api/freshguard proxy, /models, /ort wasm) + blob:/data:.
 */
export function buildCsp(opts: SecurityOptions = {}): string {
  const script = ["'self'", "'wasm-unsafe-eval'", ...(opts.extraScriptSrc ?? [])];
  const connect = ["'self'", "blob:", "data:", ...(opts.extraConnectSrc ?? [])];
  const img = ["'self'", "data:", "blob:", "https:", ...(opts.extraImgSrc ?? [])];
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src ${img.join(" ")}`,
    "media-src 'self' blob: data:",
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    hardBoundaryCsp(),
  ].join("; ");
}

/** Camera/microphone/location stay available to this origin only (barcode + produce scanning, voice, maps). */
export const PERMISSIONS_POLICY =
  "camera=(self), microphone=(self), geolocation=(self), fullscreen=(self), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()";

export function securityHeaders(opts: SecurityOptions = optionsFromEnv()): RequestHandler {
  const full = buildCsp(opts);
  const hard = hardBoundaryCsp();
  return (req: Request, res: Response, next: NextFunction) => {
    res.removeHeader("X-Powered-By");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    // req.secure honours "trust proxy", so HSTS is only sent when the client really connected over https.
    if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    if (opts.isDevelopment || opts.cspMode === "off") {
      if (!opts.isDevelopment) res.setHeader("Content-Security-Policy", hard);
    } else if (opts.cspMode === "enforce") {
      res.setHeader("Content-Security-Policy", full);
    } else {
      res.setHeader("Content-Security-Policy", hard);
      res.setHeader("Content-Security-Policy-Report-Only", full);
    }
    // API answers carry per-user data: never store them in shared caches.
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    next();
  };
}

/** Express "trust proxy" from TRUST_PROXY: a hop count, "true" (1 hop), or a subnet keyword/list. Default: off. */
export function configureTrustProxy(app: Express, env: NodeJS.ProcessEnv = process.env): void {
  const raw = (env.TRUST_PROXY ?? "").trim();
  if (!raw) return;
  if (/^\d+$/.test(raw)) app.set("trust proxy", Number(raw));
  else if (raw.toLowerCase() === "true") app.set("trust proxy", 1);
  else app.set("trust proxy", raw);
}

/**
 * Same-origin guard for state-changing requests. Browsers always send Origin on cross-site POST; when present it
 * must match this host (or an allowed origin). Requests without Origin (server to server, curl, webhooks) pass,
 * so Twilio/Meta webhooks keep working: they are authenticated by signature, not cookies.
 */
export function sameOriginGuard(allowed: string[] = []): RequestHandler {
  const extra = new Set(allowed.map(a => origin(a)).filter((a): a is string => !!a));
  const publicBase = origin(process.env.PUBLIC_BASE_URL);
  if (publicBase) extra.add(publicBase);
  return (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (!req.path.startsWith("/api/") || req.path.startsWith("/api/whatsapp/")) return next();
    const o = req.headers.origin;
    if (!o) return next();
    let host: string | null = null;
    try {
      host = new URL(String(o)).host;
    } catch {
      host = null;
    }
    // Behind a trusted proxy the public host arrives in X-Forwarded-Host (Express only honours it with "trust proxy").
    const fwd = req.app.get("trust proxy") ? String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim() : "";
    const ok = host !== null && (host === req.get("host") || (fwd !== "" && host === fwd) || extra.has(String(o)));
    if (ok) return next();
    res.status(403).json({ error: "Cross-origin request blocked." });
  };
}

export type BodyLimits = { default: string; trpc: string; freshguard: string };

export const DEFAULT_BODY_LIMITS: BodyLimits = {
  default: "1mb",
  // scanner.uploadImage carries a base64 photo: 16 MB of bytes is about 22 MB of base64 (see MAX_UPLOAD_BYTES in routers.ts).
  trpc: "24mb",
  // The client downscales photos to JPEG <= 1280 px; the detect proxy additionally caps Content-Length at 10 MB.
  freshguard: "15mb",
};

/** Mount AFTER the raw-body webhooks. Longest prefix wins; everything else gets the small default. */
export function mountBodyParsers(app: Express, limits: BodyLimits = DEFAULT_BODY_LIMITS): void {
  const parsers: Array<[string, RequestHandler]> = [
    ["/api/trpc", express.json({ limit: limits.trpc })],
    ["/api/freshguard", express.json({ limit: limits.freshguard })],
  ];
  const fallback = express.json({ limit: limits.default });
  const urlencoded = express.urlencoded({ limit: limits.default, extended: false });
  app.use((req, res, next) => {
    for (const [prefix, parser] of parsers) {
      if (req.path === prefix || req.path.startsWith(prefix + "/")) return parser(req, res, next);
    }
    return fallback(req, res, next);
  });
  app.use(urlencoded);
}

/** One-time production warning: X-Forwarded-For present but trust proxy off means per-IP limits see the proxy only. */
export function warnIfProxyMisconfigured(app: Express, warn: (msg: string) => void): RequestHandler {
  let warned = false;
  return (req, _res, next) => {
    if (!warned && req.headers["x-forwarded-for"] && !app.get("trust proxy")) {
      warned = true;
      warn("X-Forwarded-For received but TRUST_PROXY is not set: rate limits and secure-cookie detection will see the proxy address. Set TRUST_PROXY=1 behind a single reverse proxy.");
    }
    next();
  };
}
