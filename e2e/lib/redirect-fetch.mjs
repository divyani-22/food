// Preload for e2e runs of the real server (node --import ./e2e/lib/redirect-fetch.mjs ...).
// Rewrites HTTPS requests to Twilio's API host onto a local stub (STUB_URL), exactly like a DNS override
// would. Production code is untouched, so its SSRF allowlist and URL handling are tested as written.
const stub = process.env.E2E_STUB_URL;
if (stub) {
  const original = globalThis.fetch;
  const hosts = ["https://api.twilio.com", "https://media.twiliocdn.com"];
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const host = hosts.find((h) => url.startsWith(h));
    return original(host ? stub + url.slice(host.length) : input, init);
  };
}
