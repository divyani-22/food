import crypto from "crypto";
import fs from "fs";
import path from "path";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Session signing secret.
 * - JWT_SECRET always wins.
 * - Production without JWT_SECRET yields "" and the server refuses to start (see assertRuntimeConfig).
 * - Development without JWT_SECRET: a random secret is generated once and persisted to data/.dev-secret
 *   (gitignored) so sessions survive restarts with zero configuration.
 * - Test runs get a throwaway in-memory secret and never touch the disk.
 */
function resolveCookieSecret(): string {
  const fromEnv = process.env.JWT_SECRET ?? "";
  if (fromEnv) return fromEnv;
  if (isProduction) return "";
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return crypto.randomBytes(32).toString("hex");

  const secretPath = path.resolve(process.cwd(), "data", ".dev-secret");
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {
    // not created yet
  }
  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, generated + "\n", { mode: 0o600 });
    console.log(`[Auth] JWT_SECRET not set: generated a development secret at ${secretPath}`);
  } catch (error) {
    console.warn("[Auth] JWT_SECRET not set and data/.dev-secret is not writable; using a temporary secret (sessions reset on restart):", error);
  }
  return generated;
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: resolveCookieSecret(),
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction,
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};

/** Throws an explicit error for configuration that must never be missing in production. */
export function assertRuntimeConfig(): void {
  if (ENV.isProduction && !ENV.cookieSecret) {
    throw new Error(
      "JWT_SECRET is required when NODE_ENV=production. Set it to a long random string (for example: openssl rand -hex 32)."
    );
  }
}
