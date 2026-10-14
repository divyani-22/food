import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  // If running locally without OAuth session, provide a local user so all features work.
  // NEVER do this in production: it would give every anonymous visitor a shared admin account.
  const allowLocalFallback = !ENV.isProduction;
  if (!user && allowLocalFallback) {
    try {
      const dbInstance = await db.getDb();
      if (dbInstance) {
        let localUser = await db.getUserByOpenId("local-dev-user");
        if (!localUser) {
          await db.upsertUser({
            openId: "local-dev-user",
            name: "Local Food Explorer",
            email: "user@localhost.com",
            loginMethod: "local",
            role: "admin",
            lastSignedIn: new Date(),
          });
          localUser = await db.getUserByOpenId("local-dev-user");
        }
        user = localUser ?? null;
      }
    } catch (e) {
      console.warn("[Auth] Fallback local user creation error:", e);
    }
  }

  if (!user && allowLocalFallback) {
    user = {
      id: 1,
      openId: "local-dev-user",
      name: "Food & Health Explorer",
      email: "user@localhost.com",
      loginMethod: "local",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
