/*
 * Application entry point — initializes Express, connects
* middleware (CORS, JSON parsing, rate limiting),
* mounts all route files, connects to MongoDB, starts the
* server
 */
import mongoose from 'mongoose';
import { authRouter } from './routes/auth.js';
import { adminBookingsRouter, bookingsRouter } from './routes/bookings.js';
import { requireAuth } from './middleware/requireAuth.js';
import { verifyCfAccess } from './middleware/verifyCfAccess.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { adminMenuRouter, menuRouter } from './routes/menu.js';
import cors from "cors";
import express from "express";
import dotenv from "dotenv";
import mongoSanitize from "express-mongo-sanitize";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The project's environment file is at the repository root, two levels above
// this entry point (backend/server/server.js).
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

//const express = require('express');
//const cors = require('cors');
//const connectToMongoDB = require('./connectToMongoDB');

const app = express();

// Render and Cloudflare sit in front of the application in production. Trust
// the first proxy so rate limiting uses the originating client address.
app.set("trust proxy", 1);

// --- MIdDLE WARE ---
app.use(express.json({ limit: "100kb" }));
// Remove MongoDB operator and dotted keys before any route can use input.
// Sanitization is applied in place because Express 5 exposes req.query as a
// read-only getter; the package's default middleware attempts to reassign it.
// Route-level validation remains necessary because sanitization is not a
// substitute for checking the expected type and shape of each field.
app.use((request, _response, next) => {
    for (const key of ["body", "params", "query"]) {
        const target = request[key];
        if (target && typeof target === "object") mongoSanitize.sanitize(target);
    }
    next();
});
app.use(securityHeaders);

const configuredOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
const defaultOrigins = process.env.NODE_ENV === "production"
    ? ["https://abct.pages.dev"]
    : ["http://127.0.0.1:5500", "http://localhost:5500", "https://abct.pages.dev"];
const allowedOrigins = new Set([...defaultOrigins, ...configuredOrigins]);

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
            callback(null, true);
    } else {
        callback(new Error('Not allowed by CORS'));
    }
}
}));

//--- ROUTES ---
app.use('/api/bookings', bookingsRouter);
app.use('/api/menu', menuRouter);
app.use('/api/admin', verifyCfAccess);
app.use('/api/admin', authRouter);
app.use('/api/admin/bookings', requireAuth, adminBookingsRouter);
app.use('/api/admin/menu', requireAuth, adminMenuRouter);

app.use((error, _request, response, _next) => {
    console.error(error);
    if (error.message === "Not allowed by CORS") {
        return response.status(403).json({ message: "Origin is not allowed." });
    }
    response.status(500).json({ message: 'An unexpected server error occurred.' });
});

const PORT = process.env.PORT || 5500;

async function startServer() {
    const productionMissingCloudflareConfig = process.env.NODE_ENV === 'production' && (
        process.env.CF_ACCESS_ENABLED !== 'true' ||
        !process.env.CF_ACCESS_AUD ||
        !process.env.CF_ACCESS_DOMAIN
    );
    if (!process.env.MONGODB_URI || !process.env.JWT_SECRET || productionMissingCloudflareConfig) {
        throw new Error('MONGODB_URI and JWT_SECRET are required. Production also requires CF_ACCESS_ENABLED=true, CF_ACCESS_AUD, and CF_ACCESS_DOMAIN.');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        console.log(`
╔════════════════════════════════════════╗
║   ABCT Web                             ║
║   By shanricz                          ║
║   Version: 1.0.0                       ║
║   License: MIT                         ║
╚════════════════════════════════════════╝
`);
  });
}

startServer().catch((err) => {
    console.error('Could not start server:', err.message);
    process.exit(1);
});
