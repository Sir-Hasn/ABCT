/**
 * Verifies that a request to admin API routes actually
passed through Cloudflare Access (checks the CfAccess-Jwt-Assertion header against Cloudflare’s
public keys) — this closes the gap where someone
could otherwise call the backend’s raw
.onrender.com URL directly and skip the Access gate
entirely
 */