/*
 * Application entry point — initializes Express, connects
* middleware (CORS, JSON parsing, rate limiting),
* mounts all route files, connects to MongoDB, starts the
* server
 */
import mongoose from 'mongoose';
import { User } from './models/Staff.js';
import { Items } from './models/MenuItem.js';
import { Bookings } from './models/Booking.js';
import { authRouter } from './routes/auth.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import cors from "cors";
import express from "express";
import dotenv from "dotenv";
import path from "path";
import dns from "node:dns";
import { fileURLToPath } from "url";
dotenv.config();

// Prefer IPv4 to avoid IPv6-only route failures (ENETUNREACH) on some cloud hosts.
dns.setDefaultResultOrder("ipv4first");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create the Express app.
const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET || !process.env.CF_ACCESS_AUD || !process.env.CF_ACCESS_DOMAIN) {
  console.error("Error: One or more required environment variables are not defined.");
  process.exit(1);
}
