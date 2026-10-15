import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // const hostname = req.hostname;
  // const shouldSetDomain =
  //   hostname &&
  //   !LOCAL_HOSTS.has(hostname) &&
  //   !isIpAddress(hostname) &&
  //   hostname !== "127.0.0.1" &&
  //   hostname !== "::1";

  // const domain =
  //   shouldSetDomain && !hostname.startsWith(".")
  //     ? `.${hostname}`
  //     : shouldSetDomain
  //       ? hostname
  //       : undefined;

  // COOKIE_SAMESITE=lax|strict|none overrides the default. "none" (default over https) is needed only when the app
  // is embedded cross-site (for example in a preview iframe); same-site deployments should set "lax".
  const secure = isSecureRequest(req);
  const configured = (process.env.COOKIE_SAMESITE ?? "").toLowerCase();
  let sameSite: "lax" | "strict" | "none" = secure ? "none" : "lax";
  if (configured === "lax" || configured === "strict") sameSite = configured;
  else if (configured === "none" && secure) sameSite = "none";

  return {
    httpOnly: true,
    path: "/",
    // SameSite=None requires Secure; browsers drop the cookie on plain-http (local dev) otherwise.
    sameSite,
    secure,
  };
}
