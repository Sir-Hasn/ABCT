// Set this value to the deployed HTTPS backend URL before publishing the
// admin Pages site. It is intentionally not a secret.
const localHosts = new Set(["localhost", "127.0.0.1"]);
const isLocalAdmin = localHosts.has(window.location.hostname);
const PRODUCTION_API_URL = "";

window.ABCT_API_BASE_URL = String(
  window.ABCT_API_BASE_URL || (isLocalAdmin ? "http://127.0.0.1:3101" : PRODUCTION_API_URL)
).replace(/\/+$/, "");

window.ABCT_API_CONFIGURED = Boolean(window.ABCT_API_BASE_URL);
