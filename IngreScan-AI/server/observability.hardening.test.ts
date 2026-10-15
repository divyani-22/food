import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { errorHandler, registerHealthRoutes, requestLogger, scrub, setLogSink, log, checkDatabase } from "./lib/observability";
import { closeDatabase } from "./_core/database";
import { getSessionCookieOptions } from "./_core/cookies";

describe("structured logging and error handling", () => {
  let s: http.Server;
  let base = "";
  const lines: any[] = [];
  const state = { shuttingDown: false };
  beforeAll(async () => {
    setLogSink(l => lines.push(JSON.parse(l)));
    const app = express();
    app.use(requestLogger());
    registerHealthRoutes(app, state);
    app.use(express.json({ limit: "1kb" }));
    app.get("/boom", () => {
      throw new Error("db password=hunter2 for +14155550123 user a@b.co");
    });
    app.post("/api/echo", (req, res) => res.json({ ok: true }));
    app.use(errorHandler());
    await new Promise<void>(r => (s = http.createServer(app).listen(0, "127.0.0.1", r)));
    base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    setLogSink(null);
    await new Promise(r => s.close(r));
    await closeDatabase();
  });
  afterEach(() => (lines.length = 0));

  it("logs one JSON line per request without query, headers or body, and echoes a request id", async () => {
    const r = await fetch(base + "/api/echo?token=SECRETQ", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer SECRETBEARER", cookie: "app_session_id=SECRETCOOKIE", "x-request-id": "client-req-12345" },
      body: JSON.stringify({ phone: "+14155550123", password: "SECRETBODY" }),
    });
    expect(r.headers.get("x-request-id")).toBe("client-req-12345");
    const entry = lines.find(l => l.msg === "request");
    expect(entry).toMatchObject({ level: "info", method: "POST", path: "/api/echo", status: 200, reqId: "client-req-12345" });
    expect(typeof entry.durationMs).toBe("number");
    const dump = JSON.stringify(lines);
    for (const secret of ["SECRETQ", "SECRETBEARER", "SECRETCOOKIE", "SECRETBODY", "4155550123"]) expect(dump).not.toContain(secret);
  });

  it("replaces unsafe inbound request ids", async () => {
    const r = await fetch(base + "/healthz", { headers: { "x-request-id": "bad id\twith spaces and <script>" } });
    expect(r.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("central error handler returns a safe message and logs a scrubbed error", async () => {
    const r = await fetch(base + "/boom?x=1");
    expect(r.status).toBe(500);
    const text = await r.text();
    expect(text).not.toMatch(/hunter2|4155550123|a@b\.co|Error:|at /);
    expect(text).toContain("Internal server error");
    const dump = JSON.stringify(lines);
    expect(dump).not.toMatch(/hunter2|4155550123|a@b\.co/);
    expect(lines.some(l => l.msg === "unhandled_route_error" && l.level === "error")).toBe(true);
    expect(lines.find(l => l.msg === "request").status).toBe(500);
  });

  it("maps body-parser errors to 413/400 JSON", async () => {
    const big = await fetch(base + "/api/echo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "x".repeat(3000) }) });
    expect(big.status).toBe(413);
    expect((await big.json()).error).toBe("Request body is too large.");
    const bad = await fetch(base + "/api/echo", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(bad.status).toBe(400);
  });

  it("/healthz and /readyz leak nothing and reflect state", async () => {
    const h = await fetch(base + "/healthz");
    expect(await h.json()).toEqual({ status: "ok" });
    process.env.SQLITE_PATH = "/tmp/hard-readyz-unit.db";
    const r = await fetch(base + "/readyz");
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body).toEqual({ status: "ready", database: "up", freshguard: "skipped" });
    expect(await checkDatabase()).toBe(true);
    state.shuttingDown = true;
    expect((await fetch(base + "/readyz")).status).toBe(503);
    state.shuttingDown = false;
  });

  it("scrub removes tokens, emails and numbers", () => {
    const out = scrub("Bearer abc.def eyJhbGciOi.eyJzdWIiOi.sig token=zzz mail me@x.io tel +91 98765 43210");
    expect(out).not.toMatch(/abc\.def|eyJhbGci|zzz|me@x\.io|98765/);
    log("debug", "ignored");
  });
});

describe("cookie flags", () => {
  const req = (headers: Record<string, string>, protocol = "http") => ({ protocol, headers }) as any;
  it("is httpOnly, and Secure + SameSite=None behind https; Lax on plain http", () => {
    expect(getSessionCookieOptions(req({}))).toMatchObject({ httpOnly: true, secure: false, sameSite: "lax", path: "/" });
    expect(getSessionCookieOptions(req({ "x-forwarded-proto": "https" }))).toMatchObject({ httpOnly: true, secure: true, sameSite: "none" });
  });
  it("COOKIE_SAMESITE=lax tightens an https deployment", () => {
    process.env.COOKIE_SAMESITE = "lax";
    try {
      expect(getSessionCookieOptions(req({}, "https"))).toMatchObject({ secure: true, sameSite: "lax" });
    } finally {
      delete process.env.COOKIE_SAMESITE;
    }
  });
});
