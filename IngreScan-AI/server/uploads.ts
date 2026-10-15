/**
 * Authenticated delivery of locally stored user uploads (scan / label photos).
 *
 * Files are written by storagePut() (server/storage.ts) into <cwd>/uploads and referenced as `/uploads/<name>`.
 * That URL format is unchanged (no client change, old rows keep working) but it is now answered by this handler
 * instead of a public static directory:
 *  - 401 for anonymous callers,
 *  - 404 (never 403, so existence is not leaked) unless the file belongs to the caller,
 *  - the content type comes from a fixed map keyed by the stored extension, never from user input,
 *  - the name must be a single safe path segment and the real path must stay inside the uploads directory.
 *
 * Ownership: uploadImage names files `scans_<userId>_<ts>-<rand>-<name>` (server-generated, unforgeable), so that
 * prefix proves ownership. Files without that prefix (older deployments) are served only if a food_scans row of the
 * caller references them via image_url or image_key.
 */
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import { and, eq, or } from "drizzle-orm";
import { getDbContext } from "./_core/database";

export const UPLOADS_ROUTE = "/uploads";

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,299}$/;

/** Raster formats only. SVG/HTML/anything else is delivered as an opaque download, never rendered. */
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
};

export function contentTypeForName(name: string): string {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

export function getUploadsDir(): string {
  return path.resolve(process.cwd(), "uploads");
}

/** Single safe segment: no separators, NUL, leading dot, or traversal. Returns null when unacceptable. */
export function validateUploadName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!SAFE_NAME.test(raw) || raw.includes("..")) return null;
  return raw;
}

/** Resolves to the real file inside the uploads dir, or null (missing, symlink escape, not a regular file). */
export async function resolveUploadFile(uploadsDir: string, name: string): Promise<string | null> {
  const safe = validateUploadName(name);
  if (!safe) return null;
  try {
    const rootReal = await fs.promises.realpath(uploadsDir);
    const candidate = path.resolve(rootReal, safe);
    if (path.dirname(candidate) !== rootReal) return null;
    const st = await fs.promises.lstat(candidate);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const real = await fs.promises.realpath(candidate);
    if (path.dirname(real) !== rootReal) return null;
    return real;
  } catch {
    return null;
  }
}

export function ownerIdFromName(name: string): number | null {
  const m = /^scans_(\d{1,12})_/.exec(name);
  return m ? Number(m[1]) : null;
}

export type UploadDeps = {
  uploadsDir?: string;
  /** Resolves the signed-in user id, or null when anonymous. */
  getUserId: (req: Request, res: Response) => Promise<number | null>;
  /** Legacy ownership: does a scan of this user reference the file? */
  userReferencesFile?: (userId: number, name: string) => Promise<boolean>;
};

/** Default legacy lookup against food_scans (works on SQLite and MySQL). */
export async function scanReferencesFile(userId: number, name: string): Promise<boolean> {
  const ctx = await getDbContext();
  if (!ctx) return false;
  const t = ctx.s.foodScans;
  const url = `${UPLOADS_ROUTE}/${name}`;
  const rows = await ctx.db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.userId, userId), or(eq(t.imageUrl, url), eq(t.imageKey, name))))
    .limit(1);
  return rows.length > 0;
}

export function registerUploadRoutes(app: Express, deps: UploadDeps) {
  const dir = deps.uploadsDir ?? getUploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  const legacy = deps.userReferencesFile ?? scanReferencesFile;

  const handler = async (req: Request, res: Response) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    const notFound = () => void res.status(404).type("text/plain").send("Not found");
    try {
      const userId = await deps.getUserId(req, res);
      if (userId == null) return void res.status(401).type("text/plain").send("Authentication required");

      const name = validateUploadName(req.params.name);
      if (!name) return notFound();

      let allowed = ownerIdFromName(name) === userId;
      if (!allowed && ownerIdFromName(name) === null) allowed = await legacy(userId, name);
      if (!allowed) return notFound();

      const file = await resolveUploadFile(dir, name);
      if (!file) return notFound();

      res.setHeader("Content-Type", contentTypeForName(name));
      res.setHeader("Content-Disposition", contentTypeForName(name) === "application/octet-stream" ? "attachment" : "inline");
      // Defence in depth if a non-image ever slips through: nothing may execute or load from this response.
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.sendFile(file, { dotfiles: "deny", cacheControl: false, headers: {} }, err => {
        if (err && !res.headersSent) notFound();
      });
    } catch {
      if (!res.headersSent) res.status(500).type("text/plain").send("Internal error");
    }
  };

  app.get(`${UPLOADS_ROUTE}/:name`, handler);
  // Anything else under /uploads (directory listing, nested paths, other verbs) is not served.
  app.all(`${UPLOADS_ROUTE}`, (_req, res) => void res.status(404).type("text/plain").send("Not found"));
  app.all(`${UPLOADS_ROUTE}/*`, (req, res) => {
    if (req.method === "GET" || req.method === "HEAD") {
      // GET with extra segments (e.g. /uploads/a/b) is never valid.
      return void res.status(404).type("text/plain").send("Not found");
    }
    res.status(405).type("text/plain").send("Method not allowed");
  });
}

/**
 * FreshGuard (Flask) saves produce photos under <repo>/static/uploads with random 32-hex names and they are shown
 * right after classification, before any database row references them. They are therefore gated by sign-in only
 * (no per-user ownership), with the same name / symlink / content-type rules as above.
 */
export function registerSignedInStaticUploads(app: Express, mounts: string[], dir: string, getUserId: UploadDeps["getUserId"]) {
  for (const mount of mounts) {
    // Mounted at the static root (not at <mount>/uploads) and matched on the DECODED, normalised path: express.static
    // decodes %XX and collapses "//", "/./" and "/x/../", so "/static//uploads/f", "/static/%75ploads/f" or
    // "/static/samples/../uploads/f" would otherwise skip a router-level "/static/uploads" match and be served unauthenticated.
    app.use(mount, async (req: Request, res: Response, next) => {
      let decoded: string;
      try {
        decoded = decodeURIComponent(req.path);
      } catch {
        return next(); // malformed escape: express.static answers 400
      }
      if (decoded.includes("\0")) return next();
      const parts: string[] = [];
      for (const seg of decoded.split("/")) {
        if (seg === "" || seg === ".") continue;
        if (seg === "..") parts.pop();
        else parts.push(seg);
      }
      if (parts.length === 0 || parts[0].toLowerCase() !== "uploads") return next();

      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
      if (req.method !== "GET" && req.method !== "HEAD") return void res.status(405).type("text/plain").send("Method not allowed");
      try {
        const userId = await getUserId(req, res);
        if (userId == null) return void res.status(401).type("text/plain").send("Authentication required");
        const name = parts.length === 2 ? validateUploadName(parts[1]) : null;
        const file = name ? await resolveUploadFile(dir, name) : null;
        if (!file || !name) return void res.status(404).type("text/plain").send("Not found");
        res.setHeader("Content-Type", contentTypeForName(name));
        res.setHeader("Content-Disposition", contentTypeForName(name) === "application/octet-stream" ? "attachment" : "inline");
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        res.sendFile(file, { dotfiles: "deny", cacheControl: false }, err => {
          if (err && !res.headersSent) res.status(404).type("text/plain").send("Not found");
        });
      } catch {
        if (!res.headersSent) res.status(404).type("text/plain").send("Not found");
      }
    });
  }
}

/** Default session lookup shared by both handlers: same authentication as tRPC (including the dev-mode local user). */
export async function sessionUserId(req: Request, res: Response): Promise<number | null> {
  const { createContext } = await import("./_core/context");
  const { user } = await createContext({ req, res } as any);
  return user ? user.id : null;
}
