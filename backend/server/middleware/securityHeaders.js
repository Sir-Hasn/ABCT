import { isProductionEnvironment } from "../config/env.js";

function securityHeaders(request, response, next) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-DNS-Prefetch-Control", "off");
  response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  response.setHeader("Origin-Agent-Cluster", "?1");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");

  if (isProductionEnvironment()) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  if (request.path === "/api/admin" || request.path.startsWith("/api/admin/")) {
    response.setHeader("Cache-Control", "no-store");
  }

  next();
}

export { securityHeaders };
