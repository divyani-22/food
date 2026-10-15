import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { buildCsp, configureTrustProxy, mountBodyParsers, PERMISSIONS_POLICY, sameOriginGuard, securityHeaders, hardBoundaryCsp } from "./lib/security";

function start(app: express.Express): Promise<{ server: http.Server; base: string }> {
  return new Promise(resolve => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

describe("security headers", () => {
  let s: http.Server;
  let base = "";
  let rawBody = "";
  beforeAll(async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(securityHeaders({ cspMode: "report-only", extraScriptSrc: [], extraConnectSrc: [] }));
    app.use(sameOriginGuard());
    // raw-body webhook mounted BEFORE the json parsers, as in index.ts
    app.post("/api/whatsapp/twilio", express.text({ type: "application/x-www-form-urlencoded", limit: "200kb" }), (req, res) => {
      rawBody = req.body;
      res.json({ ok: true });
    });
    mountBodyParsers(app, { default: "1kb", trpc: "4kb", freshguard: "8kb" });
    app.post("/api/trpc/x", (req, res) => res.json({ got: JSON.stringify(req.body).length }));
    app.post("/api/freshguard/predict", (req, res) => res.json({ got: JSON.stringify(req.body).length }));
    app.post("/api/other", (req, res) => res.json({ got: JSON.stringify(req.body).length }));
    app.get("/api/ping", (_req, res) => res.json({ ok: true }));
    app.get("/", (_req, res) => res.send("hi"));
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ type: err.type }));
    ({ server: s, base } = await start(app));
  });
  afterAll(() => new Promise(r => s.close(r)));

  it("sets the baseline headers and no x-powered-by", async () => {
    const r = await fetch(base + "/");
    expect(r.headers.get("x-powered-by")).toBeNull();
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(r.headers.get("permissions-policy")).toBe(PERMISSIONS_POLICY);
    expect(r.headers.get("permissions-policy")).toContain("camera=(self)");
    expect(r.headers.get("content-security-policy")).toBe(hardBoundaryCsp());
    expect(r.headers.get("content-security-policy-report-only")).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(r.headers.get("strict-transport-security")).toBeNull();
    expect((await fetch(base + "/api/ping")).headers.get("cache-control")).toBe("no-store");
  });

  it("sends HSTS only when the proxy says the client used https", async () => {
    const secure = await fetch(base + "/", { headers: { "x-forwarded-proto": "https" } });
    expect(secure.headers.get("strict-transport-security")).toContain("max-age=");
    const plain = await fetch(base + "/", { headers: { "x-forwarded-proto": "http" } });
    expect(plain.headers.get("strict-transport-security")).toBeNull();
  });

  it("does not trust x-forwarded-proto when trust proxy is off", async () => {
    const app = express();
    app.use(securityHeaders({ cspMode: "off" }));
    app.get("/", (_q, r) => void r.send("x"));
    const { server, base: b } = await start(app);
    const r = await fetch(b + "/", { headers: { "x-forwarded-proto": "https" } });
    expect(r.headers.get("strict-transport-security")).toBeNull();
    await new Promise(res => server.close(res));
  });

  it("enforce mode sends the full policy as Content-Security-Policy", async () => {
    const app = express();
    app.use(securityHeaders({ cspMode: "enforce" }));
    app.get("/", (_q, r) => void r.send("x"));
    const { server, base: b } = await start(app);
    const r = await fetch(b + "/");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("content-security-policy-report-only")).toBeNull();
    await new Promise(res => server.close(res));
  });

  it("CSP allows what the app needs and nothing risky", () => {
    const csp = buildCsp({});
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toMatch(/script-src [^;]*(?!'unsafe-inline')/);
    expect(csp.match(/script-src[^;]*/)![0]).not.toContain("unsafe-inline");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("keeps the raw webhook body intact and enforces per-route JSON limits", async () => {
    const form = "From=whatsapp%3A%2B1555&Body=hello";
    await fetch(base + "/api/whatsapp/twilio", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
    expect(rawBody).toBe(form);
    const post = (p: string, n: number) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "x".repeat(n) }) });
    expect((await post("/api/other", 2000)).status).toBe(413);
    expect((await post("/api/other", 500)).status).toBe(200);
    expect((await post("/api/trpc/x", 3000)).status).toBe(200);
    expect((await post("/api/trpc/x", 6000)).status).toBe(413);
    expect((await post("/api/freshguard/predict", 7000)).status).toBe(200);
    expect((await post("/api/freshguard/predict", 9000)).status).toBe(413);
  });

  it("blocks cross-origin state changes, allows same-origin and origin-less calls", async () => {
    const h = { "content-type": "application/json" };
    const body = JSON.stringify({ a: 1 });
    expect((await fetch(base + "/api/other", { method: "POST", headers: { ...h, origin: "https://evil.example" }, body })).status).toBe(403);
    expect((await fetch(base + "/api/other", { method: "POST", headers: { ...h, origin: base }, body })).status).toBe(200);
    expect((await fetch(base + "/api/other", { method: "POST", headers: h, body })).status).toBe(200);
    // webhooks are signature-authenticated and have no browser origin; they are exempt
    expect((await fetch(base + "/api/whatsapp/twilio", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" }, body: "a=1" })).status).toBe(200);
    // GET stays open
    expect((await fetch(base + "/api/ping", { headers: { origin: "https://evil.example" } })).status).toBe(200);
  });

  it("sends no CORS allow headers", async () => {
    const r = await fetch(base + "/api/ping", { headers: { origin: "https://evil.example" } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("configureTrustProxy parses hop counts and keywords", () => {
    const app = express();
    configureTrustProxy(app, { TRUST_PROXY: "2" } as any);
    expect(app.get("trust proxy")).toBe(2);
    configureTrustProxy(app, { TRUST_PROXY: "true" } as any);
    expect(app.get("trust proxy")).toBe(1);
    configureTrustProxy(app, { TRUST_PROXY: "loopback" } as any);
    expect(app.get("trust proxy")).toBe("loopback");
  });
});
