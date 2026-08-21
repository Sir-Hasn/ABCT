import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

let client;

function accessDomain() {
  // The environment variable is intentionally stored as a hostname. This
  // prevents accidental double schemes in the JWKS URL and issuer value.
  return String(process.env.CF_ACCESS_DOMAIN || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function cloudflareAccessEnabled() {
  return process.env.CF_ACCESS_ENABLED === "true";
}

function getClient() {
  if (!client) {
    const domain = accessDomain();
    if (!domain) throw new Error("CF_ACCESS_DOMAIN is required when Cloudflare Access is enabled.");
    client = jwksClient({
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 60 * 60 * 1000,
      rateLimit: true,
      jwksUri: `https://${domain}/cdn-cgi/access/certs`,
    });
  }
  return client;
}

function getSigningKey(header, callback) {
  getClient().getSigningKey(header.kid, (error, key) => {
    callback(error, key?.getPublicKey());
  });
}

function verifyCfAccess(request, response, next) {
  // Cloudflare does not issue assertions during local development. Production
  // startup requires this switch to be enabled, so it cannot be bypassed there.
  if (!cloudflareAccessEnabled()) {
    return next();
  }

  if (!process.env.CF_ACCESS_AUD || !accessDomain()) {
    return response.status(503).json({ message: "Cloudflare Access is not configured." });
  }

  const assertion = request.get("cf-access-jwt-assertion");
  if (!assertion) {
    return response.status(403).json({ message: "Cloudflare Access authentication is required." });
  }

  try {
    jwt.verify(
      assertion,
      getSigningKey,
      {
        algorithms: ["RS256"],
        audience: process.env.CF_ACCESS_AUD,
        issuer: `https://${accessDomain()}`,
      },
      (error, decoded) => {
        if (error || !decoded || typeof decoded !== "object") {
          return response.status(403).json({ message: "Cloudflare Access authentication failed." });
        }

        request.cloudflareAccess = decoded;
        next();
      }
    );
  } catch {
    return response.status(503).json({ message: "Cloudflare Access verification is unavailable." });
  }
}

export { verifyCfAccess };
