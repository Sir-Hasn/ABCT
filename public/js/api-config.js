// The public site uses its same-origin Pages Function in production and the
// local backend during development.
const localHosts = new Set(["localhost", "127.0.0.1"]);
const isLocalPublicSite = localHosts.has(window.location.hostname);

window.ABCT_API_BASE_URL = String(
  window.ABCT_API_BASE_URL ||
    (isLocalPublicSite ? "http://127.0.0.1:3101" : window.location.origin),
).replace(/\/+$/, "");
