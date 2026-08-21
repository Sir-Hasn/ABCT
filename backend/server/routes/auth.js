import bcrypt from "bcrypt";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { loginLimiter } from "../middleware/rateLimiter.js";
import { User } from "../models/Staff.js";

const authRouter = Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PASSWORD_LENGTH = 256;

authRouter.post("/login", loginLimiter, async (request, response, next) => {
  try {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      return response.status(400).json({ message: "Email and password are required." });
    }

    const { userEmail, password } = request.body;

    if (
      typeof userEmail !== "string" ||
      typeof password !== "string" ||
      userEmail.length > 254 ||
      password.length > MAX_PASSWORD_LENGTH ||
      !EMAIL_PATTERN.test(userEmail.trim())
    ) {
      return response.status(400).json({ message: "Email and password are required." });
    }

    const user = await User.findOne({ userEmail: userEmail.trim().toLowerCase() })
      .select("+userPassword");
    const passwordMatches = user && await bcrypt.compare(password, user.userPassword);

    // Use the same response for an unknown email and a wrong password.
    if (!passwordMatches) {
      return response.status(401).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      { role: user.userRole },
      process.env.JWT_SECRET,
      {
        subject: user.id,
        issuer: "abct-api",
        audience: "abct-admin",
        expiresIn: process.env.JWT_EXPIRES_IN || "8h",
      }
    );

    response.status(200).json({
      token,
      user: {
        id: user.id,
        name: user.userName,
        role: user.userRole,
      },
    });
  } catch (error) {
    next(error);
  }
});

export { authRouter };
