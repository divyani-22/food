import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { sameOriginGuard } from "./lib/security";

let server: http.Server;
let port = 0;
const post = (p: string, headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method: "POST", headers }, res => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });

beforeAll(async () => {
  const app = express();
  app.use(sameOriginGuard([]));
  // Express routing is case-insensitive by default, so /API/TRPC reaches the same handler as /api/trpc.
  app.use("/api/trpc", (_req, res) => res.send("handled"));
  app.post("/api/whatsapp/twilio", (_req, res) => res.send("hook"));
  server = http.createServer(app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise(r => server.close(r));
});

describe("same-origin guard cannot be skipped by changing the case of the path", () => {
  const evil = { origin: "https://evil.example" };
  it("blocks cross-origin writes on every spelling that Express routes to /api", async () => {
    for (const p of ["/api/trpc/x", "/API/trpc/x", "/Api/TRPC/x"]) {
      expect(await post(p, evil), p).toBe(403);
    }
  });
  it("still lets same-origin, origin-less and webhook calls through", async () => {
    expect(await post("/API/trpc/x", { origin: `http://127.0.0.1:${port}` })).toBe(200);
    expect(await post("/api/trpc/x", {})).toBe(200);
    expect(await post("/api/whatsapp/twilio", evil)).toBe(200);
  });
});
