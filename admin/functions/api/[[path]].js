/**
 * Same-origin API proxy for the protected admin Pages site.
 *
 * Cloudflare Access authenticates the Pages request before this function
 * forwards it to Render. The backend validates the signed
 * Cf-Access-Jwt-Assertion header itself.
 *
 * Configure BACKEND_URL in the admin Pages project, for example:
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

function backendUrlFor(request, backendOrigin) {
  const origin = String(backendOrigin || "").trim().replace(/\/+$/, "");
  if (!origin) throw new Error("BACKEND_URL is not configured for the Pages API proxy.");

  const backendUrl = new URL(origin);
  if (backendUrl.protocol !== "https:") throw new Error("BACKEND_URL must use HTTPS.");

  const requestUrl = new URL(request.url);
  backendUrl.pathname = requestUrl.pathname;
  backendUrl.search = requestUrl.search;
  return backendUrl;
}

function proxyHeaders(request) {
  const headers = new Headers(request.headers);
  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header);
  headers.delete("cookie");
  headers.delete("origin");
  return headers;
}

export async function onRequest(context) {
  let targetUrl;
  try {
    targetUrl = backendUrlFor(context.request, context.env.BACKEND_URL);
  } catch (error) {
    return Response.json({ message: error.message }, { status: 500 });
  }

  const method = context.request.method.toUpperCase();
  try {
    return await fetch(new Request(targetUrl, {
      method,
      headers: proxyHeaders(context.request),
      body: method === "GET" || method === "HEAD" ? undefined : context.request.body,
      redirect: "manual",
    }));
  } catch {
    return Response.json({ message: "The API service is temporarily unavailable." }, { status: 502 });
  }
}
