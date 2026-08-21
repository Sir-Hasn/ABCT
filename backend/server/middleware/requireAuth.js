import jwt from "jsonwebtoken";

function requireAuth(request, response, next) {
  const authorization = request.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!token) {
    return response.status(401).json({ message: "Authentication is required." });
  }

  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "abct-api",
      audience: "abct-admin",
    });
    if (
      !claims ||
      typeof claims !== "object" ||
      typeof claims.sub !== "string" ||
      !["admin", "staff"].includes(claims.role)
    ) {
      return response.status(401).json({ message: "Your session is invalid or has expired." });
    }
    request.auth = claims;
    next();
  } catch {
    response.status(401).json({ message: "Your session is invalid or has expired." });
  }
}

export { requireAuth };
