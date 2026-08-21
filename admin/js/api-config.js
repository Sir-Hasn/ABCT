// The admin site calls the same-origin Pages proxy so Cloudflare Access can
// authenticate /api/admin/* before the request reaches Render.
const localHosts = new Set(["localhost", "127.0.0.1"]);
const isLocalAdmin = localHosts.has(window.location.hostname);
const PRODUCTION_API_URL = window.location.origin;

window.ABCT_API_BASE_URL = String(
  window.ABCT_API_BASE_URL || (isLocalAdmin ? "http://127.0.0.1:3101" : PRODUCTION_API_URL)
).replace(/\/+$/, "");

window.ABCT_API_CONFIGURED = Boolean(window.ABCT_API_BASE_URL);