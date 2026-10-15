# Production hardening

Scope: the Express server in `IngreScan-AI/server`. Verified with `node e2e/hardening.mjs` (real production build, real Chromium).

## What changed

### 1. Authenticated uploads (`server/uploads.ts`)
- `/uploads/<name>` is no longer a public static directory. The URL format stored in `food_scans.image_url` is unchanged, so no client change and old rows keep working.
- Anonymous: 401. Not the owner: 404 (existence is not leaked).
- Ownership: `scanner.uploadImage` names files `scans_<userId>_<ts>-<rand>-<name>`; that server-generated prefix proves ownership. Files without the prefix (older deployments) are served only if a `food_scans` row of the caller references them by `image_url` or `image_key`.
- Content type comes from a fixed extension map (jpg, png, webp, gif, avif, bmp); anything else (html, svg) is `application/octet-stream`. Always `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Cache-Control: private, max-age=0, must-revalidate`, `Content-Security-Policy: default-src 'none'; sandbox`.
- Path safety: a name must be one segment matching `[A-Za-z0-9][A-Za-z0-9._-]*` without `..`; then `lstat` (no symlinks, regular files only) and `realpath` prefix check against the uploads directory.
- FreshGuard (Flask) produce photos under `<repo>/static/uploads` (also via `/freshguard/static/uploads`) now require a signed-in session. They are not ownership-checked because they are shown before any database row references them (names are random 32-hex).
- With `BUILT_IN_FORGE_API_URL` configured, uploads go to the external storage service and are unaffected.

### 2. Headers and request hygiene (`server/lib/security.ts`)
- `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation = self), `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Cross-Origin-Resource-Policy: same-origin`, no `X-Powered-By`, `Cache-Control: no-store` on `/api/*`.
- HSTS only when `req.secure`, which honours `TRUST_PROXY`; a spoofed `X-Forwarded-Proto` is ignored without it.
- CSP: the hard-boundary directives (`object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`) are always enforced. The full policy (self scripts + `wasm-unsafe-eval`, Google Fonts, `data:`/`blob:`/`https:` images, `worker-src 'self' blob:`, `connect-src 'self'`) is sent as `Content-Security-Policy-Report-Only` by default. `CSP_MODE=enforce` enforces it. Skipped in development (Vite).
- Same-origin guard: a state-changing `/api` request whose `Origin` differs from the host (or `ALLOWED_ORIGINS`/`PUBLIC_BASE_URL`) gets 403. WhatsApp webhooks and origin-less callers are exempt. No CORS headers are sent.
- JSON limits per route: `/api/trpc` 24 MB (16 MB photo as base64), `/api/freshguard` 15 MB (detect keeps its 10 MB cap), everything else 1 MB. WhatsApp raw-body routes stay mounted before the parsers. Oversized bodies return 413 JSON.

### 3. Logging and monitoring (`server/lib/observability.ts`)
- One JSON line per request: `ts, level, msg, reqId, method, path (no query), status, durationMs`. `X-Request-Id` is returned (a safe inbound id is reused). Bodies, cookies, Authorization and tokens are never logged; error messages are scrubbed of JWTs, bearer tokens, emails and phone numbers.
- Central error handler returns `{error, requestId}` with no stack. Body-parser errors map to 413/400.
- `unhandledRejection` and `uncaughtException` are logged (the process keeps running unless `EXIT_ON_UNCAUGHT=1`).
- SIGTERM/SIGINT: `/readyz` flips to 503, the HTTP server drains, reminder scheduler stops, DB closes, exit 0 (forced exit after `SHUTDOWN_TIMEOUT_MS`).
- `/healthz` (liveness) and `/readyz` (database reachable; FreshGuard reported as up/down/skipped, required only with `READYZ_REQUIRE_FRESHGUARD=1`). Bodies contain fixed strings only.
- Optional Sentry: if `SENTRY_DSN` is set the server tries `import("@sentry/node")` lazily. It is NOT added to package.json; run `pnpm add @sentry/node` to enable. Without the package a single warning is logged. Hook points: `reportError()` in `observability.ts`.
- No client error-reporting endpoint was added (not tiny enough to justify an unauthenticated write path).

### 4. Rate limits, cookies, proxy
- New per-IP limiters: `/api/trpc` 600/min, `/api/oauth` 60/min, `/uploads` 600/min (env-tunable). FreshGuard limits unchanged (60/min, detect 10/min).
- Session cookie: `httpOnly`, `Secure` + `SameSite=None` over https, `Lax` over http. `COOKIE_SAMESITE=lax|strict` tightens it for same-site deployments.
- `TRUST_PROXY` (hop count, `true`, or `loopback`) is configured at startup; a one-time warning is logged if `X-Forwarded-For` arrives while it is unset (all clients would otherwise share one rate-limit bucket).

## Environment keys
`TRUST_PROXY, CSP_MODE, CSP_EXTRA_SCRIPT_SRC, CSP_EXTRA_CONNECT_SRC, CSP_EXTRA_IMG_SRC, ALLOWED_ORIGINS, COOKIE_SAMESITE, RATE_LIMIT_API_PER_MIN, RATE_LIMIT_AUTH_PER_MIN, RATE_LIMIT_UPLOADS_PER_MIN, LOG_LEVEL, SENTRY_DSN, READYZ_REQUIRE_FRESHGUARD, EXIT_ON_UNCAUGHT, SHUTDOWN_TIMEOUT_MS` (all optional, see `.env.example`).

## Verification
`cd IngreScan-AI && npx tsc --noEmit && npx vitest run` (unit/integration on real Express servers: `uploads.hardening.test.ts`, `security.hardening.test.ts`, `observability.hardening.test.ts`), then `pnpm build && node e2e/hardening.mjs`.

## What remains
- The full CSP is Report-Only by default. It showed zero violations in Chromium across 14 pages, barcode decoding and on-device inference, but the Maps component (external forge script) and other third-party hosts were not exercised; set `CSP_MODE=enforce` after checking your deployment's console.
- `style-src 'unsafe-inline'` is required by React inline styles and Radix.
- Rate limiters are in-memory and per process; use the reverse proxy for multi-instance limits.
- Uploaded files on local disk are never deleted when a scan is deleted, and a user could attach another user's filename as `imageUrl` of their own scan (they would still get 404 for new-format files; legacy files are matched by row, so legacy names should be treated as unguessable-only).
- `SameSite=None` stays the https default (embedding in a cross-site preview); the Origin guard compensates. Set `COOKIE_SAMESITE=lax` for plain same-site deployments.
- Flask `/static/uploads` photos are session-gated, not per-user.
- Existing `console.*` lines elsewhere (OAuth, WhatsApp runtime) remain unstructured.
