import { rateLimit } from "express-rate-limit";

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Too many booking attempts. Please wait 15 minutes and try again.",
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Too many login attempts. Please wait 15 minutes and try again.",
  },
});

export { bookingLimiter, loginLimiter };
