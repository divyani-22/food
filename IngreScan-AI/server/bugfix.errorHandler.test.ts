import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { errorHandler, setLogSink } from "./lib/observability";

let server: http.Server;
let port = 0;
const logs: string[] = [];

const call = (p: string, method = "GET", headers: Record<string, string> = {}, body?: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => {
      const chunks: Buffer[] = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(body);
  });

beforeAll(async () => {
  setLogSink(l => logs.push(l));
  const app = express();
  app.get("/uploads/:name", (_req, res) => res.send("ok"));
  app.post("/api/json", express.json({ type: "application/json" }), (_req, res) => res.send("ok"));
  app.get("/api/boom", () => {
    throw new Error("secret detail");
  });
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  setLogSink(null);
  await new Promise(r => server.close(r));
});

describe("errorHandler maps client faults to 4xx", () => {
  it("a malformed percent-escape in a route parameter is a 400, not a 500", async () => {
    logs.length = 0;
    const r = await call("/uploads/%E0%A4%A");
    expect(r.status).toBe(400);
    expect(logs.join("")).not.toContain("unhandled_route_error");
  });
  it("genuine failures stay 500 without leaking details", async () => {
    const boom = await call("/api/boom");
    expect(boom.status).toBe(500);
    expect(boom.body).not.toContain("secret detail");
  });
});
