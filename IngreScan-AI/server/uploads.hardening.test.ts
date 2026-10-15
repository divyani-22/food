import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { contentTypeForName, ownerIdFromName, registerUploadRoutes, registerSignedInStaticUploads, validateUploadName } from "./uploads";

let server: http.Server;
let port = 0;
let dir = "";
let outside = "";
const legacyOwners = new Map<string, number>([["legacy-photo.png", 7]]);

/** Raw request so path tricks (..%2f, %00) reach the server unmodified. */
function raw(p: string, headers: Record<string, string> = {}, method = "GET"): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => {
      const chunks: Buffer[] = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hard-up-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "hard-out-"));
  fs.writeFileSync(path.join(dir, "scans_1_1700-aa-a.png"), PNG);
  fs.writeFileSync(path.join(dir, "scans_2_1700-bb-b.jpg"), PNG);
  fs.writeFileSync(path.join(dir, "scans_1_1700-cc-evil.html"), "<script>alert(1)</script>");
  fs.writeFileSync(path.join(dir, "scans_1_1700-dd-evil.svg"), "<svg onload=alert(1)/>");
  fs.writeFileSync(path.join(dir, "legacy-photo.png"), PNG);
  fs.writeFileSync(path.join(outside, "secret.png"), "TOP SECRET");
  fs.symlinkSync(path.join(outside, "secret.png"), path.join(dir, "scans_1_1700-ee-link.png"));
  fs.mkdirSync(path.join(dir, "scans_1_1700-ff-dir.png"));
  fs.writeFileSync(path.join(dir, ".hidden.png"), PNG);
  const app = express();
  registerUploadRoutes(app, {
    uploadsDir: dir,
    getUserId: async req => {
      const v = req.headers["x-test-user"];
      return typeof v === "string" ? Number(v) : null;
    },
    userReferencesFile: async (uid, name) => legacyOwners.get(name) === uid,
  });
  server = http.createServer(app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise(r => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("authenticated uploads", () => {
  it("rejects anonymous callers with 401", async () => {
    const r = await raw("/uploads/scans_1_1700-aa-a.png");
    expect(r.status).toBe(401);
    expect(r.body.equals(PNG)).toBe(false);
  });

  it("serves the owner with safe headers and a type derived from the stored extension", async () => {
    const r = await raw("/uploads/scans_1_1700-aa-a.png", { "x-test-user": "1" });
    expect(r.status).toBe(200);
    expect(r.body.equals(PNG)).toBe(true);
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-disposition"]).toBe("inline");
    expect(r.headers["cache-control"]).toMatch(/^private/);
    expect(r.headers["content-security-policy"]).toContain("sandbox");
  });

  it("returns 404 (not 403) to another user so existence is not leaked", async () => {
    const other = await raw("/uploads/scans_1_1700-aa-a.png", { "x-test-user": "2" });
    const missing = await raw("/uploads/scans_1_1700-nope.png", { "x-test-user": "2" });
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(other.body.toString()).toBe(missing.body.toString());
  });

  it("cannot be tricked by spoofing the owner prefix for legacy files", async () => {
    expect((await raw("/uploads/legacy-photo.png", { "x-test-user": "7" })).status).toBe(200);
    expect((await raw("/uploads/legacy-photo.png", { "x-test-user": "1" })).status).toBe(404);
    expect((await raw("/uploads/legacy-photo.png")).status).toBe(401);
  });

  it("never renders html or svg: opaque type, nosniff, sandbox CSP", async () => {
    for (const f of ["scans_1_1700-cc-evil.html", "scans_1_1700-dd-evil.svg"]) {
      const r = await raw(`/uploads/${f}`, { "x-test-user": "1" });
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toBe("application/octet-stream");
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
    }
  });

  it("blocks path traversal, encoded separators, NUL bytes and dotfiles", async () => {
    const h = { "x-test-user": "1" };
    const attempts = [
      "/uploads/..%2f..%2fetc%2fpasswd",
      "/uploads/%2e%2e%2fpackage.json",
      "/uploads/..%5csecret.png",
      "/uploads/scans_1_1700-aa-a.png%00.jpg",
      "/uploads/scans_1_1700-aa-a.png%00",
      "/uploads/%00",
      "/uploads/.hidden.png",
      "/uploads/scans_1_1700-aa-..a.png",
      "/uploads/../package.json",
      "/uploads//etc/passwd",
      "/uploads/a/b.png",
      "/uploads/%252e%252e%252fx",
      "/uploads/%ff%fe",
    ];
    for (const p of attempts) {
      const r = await raw(p, h);
      expect([400, 404], `${p} -> ${r.status}`).toContain(r.status);
      expect(r.body.toString()).not.toContain("TOP SECRET");
    }
  });

  it("does not follow a symlink that points outside the uploads directory", async () => {
    const r = await raw("/uploads/scans_1_1700-ee-link.png", { "x-test-user": "1" });
    expect(r.status).toBe(404);
    expect(r.body.toString()).not.toContain("TOP SECRET");
  });

  it("does not serve directories or list the folder", async () => {
    expect((await raw("/uploads/scans_1_1700-ff-dir.png", { "x-test-user": "1" })).status).toBe(404);
    expect((await raw("/uploads/", { "x-test-user": "1" })).status).toBe(404);
    expect((await raw("/uploads", { "x-test-user": "1" })).status).toBe(404);
  });

  it("rejects writes and supports HEAD", async () => {
    expect((await raw("/uploads/scans_1_1700-aa-a.png", { "x-test-user": "1" }, "POST")).status).toBeGreaterThanOrEqual(404);
    const head = await raw("/uploads/scans_1_1700-aa-a.png", { "x-test-user": "1" }, "HEAD");
    expect(head.status).toBe(200);
  });
});

describe("helpers", () => {
  it("validates names", () => {
    expect(validateUploadName("scans_1_x-y.png")).not.toBeNull();
    for (const bad of ["", ".a", "a/b", "a\\b", "a\0b", "a..b", "a b", "x".repeat(400), 5 as any]) expect(validateUploadName(bad)).toBeNull();
  });
  it("maps extension to type and extracts owner", () => {
    expect(contentTypeForName("a.JPG")).toBe("image/jpeg");
    expect(contentTypeForName("a.svg")).toBe("application/octet-stream");
    expect(contentTypeForName("noext")).toBe("application/octet-stream");
    expect(ownerIdFromName("scans_42_1-2-x.png")).toBe(42);
    expect(ownerIdFromName("legacy.png")).toBeNull();
  });
});

describe("signed-in static uploads (Flask produce photos)", () => {
  let s2: http.Server;
  let p2 = 0;
  let d2 = "";
  beforeAll(async () => {
    d2 = fs.mkdtempSync(path.join(os.tmpdir(), "hard-fg-"));
    fs.writeFileSync(path.join(d2, "abc123.jpg"), PNG);
    const app = express();
    registerSignedInStaticUploads(app, ["/static"], d2, async req => (req.headers["x-test-user"] ? 1 : null));
    s2 = http.createServer(app);
    await new Promise<void>(r => s2.listen(0, "127.0.0.1", r));
    p2 = (s2.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise(r => s2.close(r));
    fs.rmSync(d2, { recursive: true, force: true });
  });
  const get = (pth: string, h: Record<string, string> = {}) =>
    new Promise<{ status: number; type?: string }>(resolve => {
      http.get({ host: "127.0.0.1", port: p2, path: pth, headers: h }, res => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, type: res.headers["content-type"] }));
      });
    });
  it("requires a session and blocks traversal", async () => {
    expect((await get("/static/uploads/abc123.jpg")).status).toBe(401);
    const ok = await get("/static/uploads/abc123.jpg", { "x-test-user": "1" });
    expect(ok.status).toBe(200);
    expect(ok.type).toBe("image/jpeg");
    expect((await get("/static/uploads/..%2fabc123.jpg", { "x-test-user": "1" })).status).toBe(404);
    expect((await get("/static/uploads/", { "x-test-user": "1" })).status).toBe(404);
  });
});
