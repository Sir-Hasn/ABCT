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
import { isProductionEnvironment } from './config/env.js';
import cors from "cors";
import express from "express";
import mongoSanitize from "express-mongo-sanitize";
import { randomUUID } from "node:crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Keep operational logs useful without writing customer names, emails,
// booking notes, passwords, or tokens to the log stream.
app.use((request, response, next) => {
    const requestId = randomUUID();
    const startedAt = process.hrtime.bigint();
    request.requestId = requestId;
    response.setHeader("X-Request-ID", requestId);
    response.on("finish", () => {
        if (/^\/api\/(healthz|readyz)$/.test(request.path) || /^(\/healthz|\/readyz)$/.test(request.path)) return;
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        console.log(JSON.stringify({
            event: "http_request",
            requestId,
            method: request.method,
            path: request.path,
            status: response.statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
        }));
    });
    next();
});

const configuredOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
const defaultOrigins = isProductionEnvironment()
    ? ["https://abct-public.pages.dev"]
    : ["http://127.0.0.1:5500", "http://localhost:5500", "https://abct-public.pages.dev"];
const allowedOrigins = new Set([...defaultOrigins, ...configuredOrigins]);

app.use(cors({
    origin: function (origin, callback) {
        const secureProductionOrigin = !isProductionEnvironment() || !origin || origin.startsWith("https://");
        if (secureProductionOrigin && (!origin || allowedOrigins.has(origin))) {
            callback(null, true);
    } else {
        callback(new Error('Not allowed by CORS'));
    }
}
}));

// Liveness is intentionally independent of MongoDB so the host can tell
// whether the Node process is running. Readiness is used for traffic routing
// and confirms that the database connection is usable.
app.get(["/healthz", "/api/healthz"], (_request, response) => {
    response.status(200).json({ status: "ok" });
});

app.get(["/readyz", "/api/readyz"], (_request, response) => {
    const ready = mongoose.connection.readyState === 1;
    response.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready" });
});

//--- ROUTES ---
app.use('/api/bookings', bookingsRouter);
app.use('/api/menu', menuRouter);
app.use('/api/admin', verifyCfAccess);
app.use('/api/admin', authRouter);
app.use('/api/admin/bookings', requireAuth, adminBookingsRouter);
app.use('/api/admin/menu', requireAuth, adminMenuRouter);

app.use((error, request, response, _next) => {
    if (error?.type === "entity.parse.failed" || error instanceof SyntaxError && error.status === 400 && "body" in error) {
        return response.status(400).json({
            message: "Request body contains invalid JSON.",
            requestId: request.requestId,
        });
    }
    if (error?.type === "entity.too.large") {
        return response.status(413).json({
            message: "Request body is too large.",
            requestId: request.requestId,
        });
    }
    console.error(JSON.stringify({
        event: "request_error",
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        error: error.name || "Error",
        message: error.message,
    }));
    if (error.message === "Not allowed by CORS") {
        return response.status(403).json({ message: "Origin is not allowed.", requestId: request.requestId });
    }
    response.status(500).json({ message: 'An unexpected server error occurred.', requestId: request.requestId });
});

const PORT = process.env.PORT || 5500;

async function startServer() {
    const productionMissingCloudflareConfig = isProductionEnvironment() && (
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

export { app, startServer };

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    startServer().catch((err) => {
        console.error('Could not start server:', err.message);
        process.exit(1);
    });
}
