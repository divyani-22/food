import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { serveStatic } from "./_core/vite";

let server: http.Server;
let port = 0;
let dir = "";

const call = (method: string, p: string) =>
  new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method }, res => {
      const chunks: Buffer[] = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh2-spa-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html>SPA</html>");
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "assets", "app-abc.js"), "console.log(1)");
  fs.writeFileSync(path.join(dir, "ort.wasm"), Buffer.from([0, 0x61, 0x73, 0x6d]));
  const app = express();
  serveStatic(app, dir);
  server = http.createServer(app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise(r => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("SPA fallback", () => {
  it("serves index.html for client routes", async () => {
    for (const p of ["/", "/scanner", "/product/123?x=1.5", "/index.html"]) {
      const r = await call("GET", p);
      expect(r.status, p).toBe(200);
      expect(r.body, p).toContain("SPA");
    }
  });
  it("serves real assets with the right MIME type", async () => {
    expect((await call("GET", "/assets/app-abc.js")).type).toMatch(/javascript/);
    expect((await call("GET", "/ort.wasm")).type).toBe("application/wasm");
  });
  it("404s missing files, unknown API routes and non-GET requests instead of returning HTML", async () => {
    const missingChunk = await call("GET", "/assets/old-chunk-123.js");
    expect(missingChunk.status).toBe(404);
    expect(missingChunk.body).not.toContain("SPA");
    const api = await call("GET", "/api/nope");
    expect(api.status).toBe(404);
    expect(api.type).toMatch(/json/);
    expect((await call("POST", "/api/nope")).status).toBe(404);
    expect((await call("POST", "/scanner")).status).toBe(404);
  });
});
