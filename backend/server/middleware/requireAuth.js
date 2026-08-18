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
    request.auth = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    response.status(401).json({ message: "Your session is invalid or has expired." });
  }
}

export { requireAuth };
