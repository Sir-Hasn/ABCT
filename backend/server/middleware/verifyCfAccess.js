import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

let client;

function cloudflareAccessEnabled() {
  return process.env.CF_ACCESS_ENABLED === "true";
}

function getClient() {
  if (!client) {
    client = jwksClient({
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 60 * 60 * 1000,
      rateLimit: true,
      jwksUri: `https://${process.env.CF_ACCESS_DOMAIN}/cdn-cgi/access/certs`,
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

  const assertion = request.get("cf-access-jwt-assertion");
  if (!assertion) {
    return response.status(403).json({ message: "Cloudflare Access authentication is required." });
  }

  jwt.verify(
    assertion,
    getSigningKey,
    { algorithms: ["RS256"], audience: process.env.CF_ACCESS_AUD },
    (error, decoded) => {
      if (error) {
        return response.status(403).json({ message: "Cloudflare Access authentication failed." });
      }

      request.cloudflareAccess = decoded;
      next();
    }
  );
}

export { verifyCfAccess };
