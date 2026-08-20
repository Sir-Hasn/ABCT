/**
 * Same-origin API proxy for the Cloudflare Pages site.
 *
 * The browser calls https://abct-public.pages.dev/api/* so the Pages proxy can
 * authenticate /api/admin/* before this function forwards the request to the
 * Render origin. The backend validates the signed
 * Cf-Access-Jwt-Assertion header itself; this function never trusts a client
 * supplied identity and never exposes backend credentials.
 *
 * Configure BACKEND_URL in the Pages project environment, for example:
 *   https://abct.onrender.com
 */

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "forwarded",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function backendUrlFor(request, backendOrigin) {
  const origin = String(backendOrigin || "").trim().replace(/\/+$/, "");
  if (!origin) {
    throw new Error("BACKEND_URL is not configured for the Pages API proxy.");
  }

  const backendUrl = new URL(origin);
  if (backendUrl.protocol !== "https:") {
    throw new Error("BACKEND_URL must use HTTPS.");
  }

  const requestUrl = new URL(request.url);
  backendUrl.pathname = requestUrl.pathname;
  backendUrl.search = requestUrl.search;
  return backendUrl;
}

function proxyHeaders(request) {
  const headers = new Headers(request.headers);

  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }

  // Do not send browser cookies to Render. The signed Access assertion is
  // forwarded separately and is verified by the backend with Cloudflare's
  // public signing keys.
  headers.delete("cookie");
  // The Pages proxy is the trusted same-origin hop. Do not make the backend
  // evaluate a browser-supplied Origin from a different Pages project.
  headers.delete("origin");

  return headers;
}

export async function onRequest(context) {
  let targetUrl;

  try {
    targetUrl = backendUrlFor(context.request, context.env.BACKEND_URL);
  } catch (error) {
    return withSecurityHeaders(Response.json({ message: error.message }, { status: 500 }));
  }

  const method = context.request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  try {
    const response = await fetch(new Request(targetUrl, {
      method,
      headers: proxyHeaders(context.request),
      body: hasBody ? context.request.body : undefined,
      redirect: "manual",
    }));
    return withSecurityHeaders(response);
  } catch {
    return withSecurityHeaders(Response.json(
      { message: "The API service is temporarily unavailable." },
      { status: 502 },
    ));
  }
}
