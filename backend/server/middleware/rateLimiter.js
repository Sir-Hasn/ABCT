import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import "../config/env.js";

// Render may run more than one process. The default express-rate-limit memory
// store is process-local, so production uses a small MongoDB counter store.
// Local development and unit tests intentionally keep the memory store.
class MongoRateLimitStore {
  constructor(windowMs, prefix) {
    this.windowMs = windowMs;
    this.prefix = prefix;
    this.collection = null;
    this.localKeys = false;
  }

  async getCollection() {
    if (this.collection) return this.collection;
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      throw new Error("MongoDB is not ready for rate limiting.");
    }

    this.collection = mongoose.connection.db.collection("rate_limit_counters");
    await this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    return this.collection;
  }

  async increment(key) {
    const collection = await this.getCollection();
    const now = new Date();
    const resetAt = new Date(now.getTime() + this.windowMs);
    const documentKey = `${this.prefix}:${key}`;
    const activeReset = { $gt: [{ $ifNull: ["$resetAt", new Date(0)] }, now] };

    const result = await collection.findOneAndUpdate(
      { _id: documentKey },
      [
        {
          $set: {
            hits: {
              $cond: [
                activeReset,
                { $add: [{ $ifNull: ["$hits", 0] }, 1] },
                1,
              ],
            },
            resetAt: { $cond: [activeReset, "$resetAt", resetAt] },
          },
        },
        { $set: { expiresAt: "$resetAt" } },
      ],
      { upsert: true, returnDocument: "after" },
    );

    const document = result?.value || result;
    return {
      totalHits: Number(document?.hits || 0),
      resetTime: document?.resetAt || resetAt,
    };
  }

  async decrement(key) {
    const collection = await this.getCollection();
    await collection.updateOne({ _id: `${this.prefix}:${key}` }, { $inc: { hits: -1 } });
  }

  async resetKey(key) {
    const collection = await this.getCollection();
    await collection.deleteOne({ _id: `${this.prefix}:${key}` });
  }

  async resetAll() {
    const collection = await this.getCollection();
    await collection.deleteMany({ _id: { $regex: `^${this.prefix}:` } });
  }
}

function productionStore(windowMs, prefix) {
  return process.env.NODE_ENV === "production" && process.env.MONGODB_URI
    ? new MongoRateLimitStore(windowMs, prefix)
    : undefined;
}

const bookingWindowMs = 15 * 60 * 1000;
const bookingLimiterOptions = {
  windowMs: bookingWindowMs,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Too many booking attempts. Please wait 15 minutes and try again.",
  },
};
const bookingStore = productionStore(bookingWindowMs, "booking");
if (bookingStore) bookingLimiterOptions.store = bookingStore;
const bookingLimiter = rateLimit(bookingLimiterOptions);

const loginWindowMs = 15 * 60 * 1000;
const loginLimiterOptions = {
  windowMs: loginWindowMs,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Too many login attempts. Please wait 15 minutes and try again.",
  },
};
const loginStore = productionStore(loginWindowMs, "login");
if (loginStore) loginLimiterOptions.store = loginStore;
const loginLimiter = rateLimit(loginLimiterOptions);

export { bookingLimiter, loginLimiter };
