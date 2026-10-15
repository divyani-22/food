import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { registerSignedInStaticUploads } from "./uploads";

// Mirrors server/_core/index.ts: the signed-in handler is mounted first, then express.static serves the rest of static/.
let server: http.Server;
let port = 0;
let root = "";

const get = (p: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: p, headers }, res => {
        const chunks: Buffer[] = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      })
      .on("error", reject);
  });

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bh2-static-"));
  fs.mkdirSync(path.join(root, "uploads"));
  fs.mkdirSync(path.join(root, "samples"));
  fs.writeFileSync(path.join(root, "uploads", "abc123.jpg"), "PRIVATE-PHOTO");
  fs.writeFileSync(path.join(root, "samples", "apple.jpg"), "PUBLIC-SAMPLE");
  const app = express();
  const getUserId = async (req: express.Request) => (req.headers["x-test-user"] ? 1 : null);
  registerSignedInStaticUploads(app, ["/static", "/freshguard/static"], path.join(root, "uploads"), getUserId);
  app.use("/static", express.static(root));
  app.use("/freshguard/static", express.static(root));
  server = http.createServer(app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise(r => server.close(r));
  fs.rmSync(root, { recursive: true, force: true });
});

describe("anonymous access to produce photos cannot be reached through alternate spellings of /static/uploads", () => {
  const variants = [
    "/static/uploads/abc123.jpg",
    "/static//uploads/abc123.jpg",
    "/static/%75ploads/abc123.jpg",
    "/static/./uploads/abc123.jpg",
    "/static/samples/../uploads/abc123.jpg",
    "/static/UPLOADS/abc123.jpg",
    "/static/uploads%2Fabc123.jpg",
    "/freshguard/static//uploads/abc123.jpg",
    "/freshguard/static/%75ploads/abc123.jpg",
  ];
  for (const v of variants) {
    it(`anonymous ${v} is not served`, async () => {
      const r = await get(v);
      expect(r.body).not.toContain("PRIVATE-PHOTO");
      expect([401, 404]).toContain(r.status);
    });
  }
  it("signed-in users still get the photo, and public samples stay public", async () => {
    expect((await get("/static/uploads/abc123.jpg", { "x-test-user": "1" })).body).toBe("PRIVATE-PHOTO");
    expect((await get("/static//uploads/abc123.jpg", { "x-test-user": "1" })).body).toBe("PRIVATE-PHOTO");
    expect((await get("/static/samples/apple.jpg")).body).toBe("PUBLIC-SAMPLE");
  });
});
