import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import bcrypt from "bcrypt";
import cors from "cors";
import express from "express";
import mongoSanitize from "express-mongo-sanitize";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import { authRouter } from "../server/routes/auth.js";
import { adminBookingsRouter, bookingsRouter } from "../server/routes/bookings.js";
import { adminMenuRouter, menuRouter } from "../server/routes/menu.js";
import { requireAuth } from "../server/middleware/requireAuth.js";
import { verifyCfAccess } from "../server/middleware/verifyCfAccess.js";
import { securityHeaders } from "../server/middleware/securityHeaders.js";
import { User } from "../server/models/Staff.js";
import { Items } from "../server/models/MenuItem.js";
import { Bookings } from "../server/models/Booking.js";
import { BookingSlot } from "../server/models/BookingSlot.js";

process.env.JWT_SECRET = "automated-test-secret-that-is-long-enough";
process.env.CF_ACCESS_ENABLED = "false";

const PASSWORD = "Correct test password 123!";
const testMenuId = new mongoose.Types.ObjectId();
let state;
let server;
let baseUrl;
let requestCounter = 0;

function dateOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function duplicateError() {
  return { code: 11000 };
}

function chain(value) {
  return {
    sort() { return this; },
    limit() { return this; },
    session() { return this; },
    async lean() { return value; },
    async select() { return value; },
  };
}

function resetState() {
  state = {
    user: {
      _id: new mongoose.Types.ObjectId(),
      id: "test-staff-id",
      userName: "Test Staff",
      userEmail: "staff@example.com",
      userRole: "staff",
      userPassword: bcrypt.hashSync(PASSWORD, 4),
    },
    menuItems: [
      {
        _id: testMenuId,
        itemNumber: "M-001",
        itemName: "Test Ramen",
        itemDescription: "A test menu item.",
        itemPrice: 1250,
        itemCategory: "Noodles",
        itemPhotoUrl: "",
        itemAvailable: true,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        itemNumber: "M-002",
        itemName: "Archived Dish",
        itemDescription: "Not available publicly.",
        itemPrice: 500,
        itemCategory: "Archived",
        itemPhotoUrl: "",
        itemAvailable: false,
      },
    ],
    bookings: [],
    slots: [],
  };
}

function patchModels() {
  User.findOne = (filter) => chain(filter.userEmail === state.user.userEmail ? state.user : null);

  Items.find = (filter = {}) => {
    let items = state.menuItems;
    if (filter.itemAvailable !== undefined) items = items.filter((item) => item.itemAvailable === filter.itemAvailable);
    if (filter._id?.$in) items = items.filter((item) => filter._id.$in.some((id) => id.toString() === item._id.toString()));
    return chain(items);
  };
  Items.create = async (data) => {
    if (state.menuItems.some((item) => item.itemNumber === data.itemNumber)) throw duplicateError();
    const item = { ...data, _id: new mongoose.Types.ObjectId() };
    state.menuItems.push(item);
    return item;
  };
  Items.findByIdAndUpdate = async (id, updates) => {
    const item = state.menuItems.find((entry) => entry._id.toString() === id.toString());
    if (!item) return null;
    if (updates.itemNumber && state.menuItems.some((entry) => entry !== item && entry.itemNumber === updates.itemNumber)) throw duplicateError();
    Object.assign(item, updates);
    return item;
  };

  Bookings.create = async (data) => {
    const input = Array.isArray(data) ? data[0] : data;
    const booking = {
      ...input,
      _id: new mongoose.Types.ObjectId(),
      bookingID: `ABCT-TEST-${state.bookings.length + 1}`,
      bookingStatus: "pending",
      bookingDepositStatus: "unpaid",
      save: async function save() { return this; },
    };
    state.bookings.push(booking);
    return Array.isArray(data) ? [booking] : booking;
  };
  Bookings.find = (filter = {}) => chain(state.bookings.filter((booking) => !filter.bookingStatus || booking.bookingStatus === filter.bookingStatus));
  Bookings.findById = (id) => ({
    async session() {
      return state.bookings.find((booking) => booking._id.toString() === id.toString()) || null;
    },
  });

  BookingSlot.insertMany = async (documents) => {
    const duplicate = documents.some((document) => state.slots.some((slot) => slot.resource === document.resource && new Date(slot.slotStart).getTime() === new Date(document.slotStart).getTime()));
    if (duplicate) throw duplicateError();
    state.slots.push(...documents);
    return documents;
  };
  BookingSlot.deleteMany = ({ bookingId }) => ({
    async session() {
      state.slots = state.slots.filter((slot) => slot.bookingId.toString() !== bookingId.toString());
    },
  });
  mongoose.startSession = async () => ({
    async withTransaction(callback) { return callback(); },
    async endSession() {},
  });
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use((request, _response, next) => {
  for (const key of ["body", "params", "query"]) {
    const target = request[key];
    if (target && typeof target === "object") mongoSanitize.sanitize(target);
  }
  next();
});
app.use(securityHeaders);
const allowedOrigins = new Set(["http://localhost:5500", "https://abct-public.pages.dev"]);
app.use(cors({ origin(origin, callback) { callback(!origin || allowedOrigins.has(origin) ? null : new Error("Not allowed by CORS"), !origin || allowedOrigins.has(origin)); } }));
app.use("/api/bookings", bookingsRouter);
app.use("/api/menu", menuRouter);
app.use("/api/admin", verifyCfAccess);
app.use("/api/admin", authRouter);
app.use("/api/admin/bookings", requireAuth, adminBookingsRouter);
app.use("/api/admin/menu", requireAuth, adminMenuRouter);
app.use((error, _request, response, _next) => {
  if (error?.type === "entity.parse.failed" || error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return response.status(400).json({ message: "Request body contains invalid JSON." });
  }
  if (error.message === "Not allowed by CORS") return response.status(403).json({ message: "Origin is not allowed." });
  return response.status(500).json({ message: error.message });
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.0.0.${++requestCounter}`, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function staffToken() {
  const result = await request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ userEmail: state.user.userEmail, password: PASSWORD }),
  });
  assert.equal(result.response.status, 200);
  return result.body.token;
}

before(async () => {
  resetState();
  patchModels();
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => resetState());

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("protects admin data and does not return staff passwords", async () => {
  const unauthenticated = await request("/api/admin/menu");
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(unauthenticated.response.headers.get("x-frame-options"), "DENY");
  assert.equal(unauthenticated.response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(unauthenticated.response.headers.get("x-permitted-cross-domain-policies"), "none");
  assert.equal(unauthenticated.response.headers.get("cache-control"), "no-store");

  const login = await request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ userEmail: state.user.userEmail, password: PASSWORD }),
  });
  assert.equal(login.response.status, 200);
  assert.ok(login.body.token);
  assert.equal(login.body.user.userPassword, undefined);

  const wrongPassword = await request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ userEmail: state.user.userEmail, password: "wrong password" }),
  });
  const unknownEmail = await request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ userEmail: "unknown@example.com", password: "wrong password" }),
  });
  assert.equal(wrongPassword.response.status, 401);
  assert.equal(unknownEmail.response.status, 401);
  assert.deepEqual(wrongPassword.body, unknownEmail.body);

  const operatorLogin = await request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ userEmail: { $ne: null }, password: PASSWORD }),
  });
  assert.equal(operatorLogin.response.status, 400);
});

test("rejects malformed JSON, invalid menu shapes, and forged JWT claims", async () => {
  const malformed = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.0.0.${++requestCounter}` },
    body: "{ invalid",
  });
  assert.equal(malformed.status, 400);

  const token = await staffToken();
  const invalidMenu = await request("/api/admin/menu", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      itemNumber: "M-999",
      itemName: "Dish",
      itemDescription: "Description",
      itemCategory: "Test",
      itemPrice: "100",
    }),
  });
  assert.equal(invalidMenu.response.status, 400);

  const forgedToken = jwt.sign(
    { role: "admin" },
    process.env.JWT_SECRET,
    { subject: "test-staff-id", issuer: "wrong-issuer", audience: "abct-admin" }
  );
  const forgedRequest = await request("/api/admin/menu", {
    headers: { Authorization: `Bearer ${forgedToken}` },
  });
  assert.equal(forgedRequest.response.status, 401);
});

test("rejects operator-shaped booking fields before persistence", async () => {
  const operatorBooking = await request("/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      userFullName: { $ne: null },
      userPhone: "09171234567",
      userEmail: "customer@example.com",
      bookingType: "table",
      bookingDate: dateOffset(3),
      bookingTimeSlot: "18:00",
      bookingGuestCount: 2,
    }),
  });
  assert.equal(operatorBooking.response.status, 400);
});

test("returns only available public menu items and protects invalid image URLs", async () => {
  const publicMenu = await request("/api/menu");
  assert.equal(publicMenu.response.status, 200);
  assert.equal(publicMenu.body.items.length, 1);
  assert.equal(publicMenu.body.items[0].itemNumber, "M-001");

  const token = await staffToken();
  const invalidImage = await request("/api/admin/menu", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ itemNumber: "M-003", itemName: "Bad Image", itemDescription: "Test", itemPrice: 100, itemCategory: "Test", itemPhotoUrl: "http://evil.example/image.jpg" }),
  });
  assert.equal(invalidImage.response.status, 422);
  assert.match(invalidImage.body.message, /Cloudinary/);
});

test("allows staff to create, edit, archive, and reject duplicate menu numbers", async () => {
  const token = await staffToken();
  const created = await request("/api/admin/menu", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ itemNumber: "M-003", itemName: "Test Sushi", itemDescription: "Test item", itemPrice: 900, itemCategory: "Sushi", itemAvailable: true }),
  });
  assert.equal(created.response.status, 201);
  const createdId = created.body.item._id;

  const edited = await request(`/api/admin/menu/${createdId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ itemNumber: "M-030" }),
  });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.body.item.itemNumber, "M-030");

  const duplicate = await request(`/api/admin/menu/${createdId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ itemNumber: "M-001" }),
  });
  assert.equal(duplicate.response.status, 409);

  const archived = await request(`/api/admin/menu/${createdId}/availability`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ itemAvailable: false }),
  });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.body.item.itemAvailable, false);
});

test("rejects invalid phone numbers and enforces table menu notice and deposit", async () => {
  const invalidPhone = await request("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ userFullName: "Test Guest", userPhone: "123", userEmail: "guest@example.com", bookingType: "table", bookingDate: dateOffset(10), bookingTimeSlot: "18:00", bookingGuestCount: 2 }),
  });
  assert.equal(invalidPhone.response.status, 422);

  const pastDate = await request("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ userFullName: "Past Guest", userPhone: "09171234567", userEmail: "past@example.com", bookingType: "table", bookingDate: dateOffset(-1), bookingTimeSlot: "18:00", bookingGuestCount: 2 }),
  });
  assert.equal(pastDate.response.status, 422);

  const invalidTime = await request("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ userFullName: "Bad Time Guest", userPhone: "09171234567", userEmail: "badtime@example.com", bookingType: "table", bookingDate: dateOffset(5), bookingTimeSlot: "dinner", bookingGuestCount: 2 }),
  });
  assert.equal(invalidTime.response.status, 400);

  const tooSoon = await request("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ userFullName: "Test Guest", userPhone: "09171234567", userEmail: "guest@example.com", bookingType: "table", bookingDate: dateOffset(1), bookingTimeSlot: "18:00", bookingGuestCount: 2, selectedMenuItems: [{ itemId: testMenuId.toString(), quantity: 2 }] }),
  });
  assert.equal(tooSoon.response.status, 422);
  assert.match(tooSoon.body.message, /3 days/);

  const valid = await request("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ userFullName: "Test Guest", userPhone: "09171234567", userEmail: "guest@example.com", bookingType: "table", bookingDate: dateOffset(5), bookingTimeSlot: "18:00", bookingGuestCount: 2, selectedMenuItems: [{ itemId: testMenuId.toString(), quantity: 2 }] }),
  });
  assert.equal(valid.response.status, 201);
  assert.equal(valid.body.booking.foodOrderTotal, 2500);
  assert.equal(valid.body.booking.bookingDepositAmount, 500);
  assert.equal(valid.body.booking.bookingDepositStatus, "unpaid");
});

test("enforces Function Hall duration, extension fee, slot conflicts, and expiration release", async () => {
  const tooShort = await request("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ userFullName: "Hall Guest", userPhone: "09171234567", userEmail: "hall@example.com", bookingType: "function-hall", bookingDate: "2030-12-25", bookingStartTime: "10:00", bookingEndTime: "13:00", bookingGuestCount: 30 }),
  });
  assert.equal(tooShort.response.status, 422);

  const first = await request("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ userFullName: "Hall Guest", userPhone: "09171234567", userEmail: "hall@example.com", bookingType: "function-hall", bookingDate: "2030-12-25", bookingStartTime: "10:00", bookingEndTime: "15:00", bookingGuestCount: 30 }),
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.body.booking.functionHallExtensionHours, 1);
  assert.equal(first.body.booking.functionHallExtensionFee, 5000);

  const conflict = await request("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ userFullName: "Second Guest", userPhone: "09171234567", userEmail: "second@example.com", bookingType: "function-hall", bookingDate: "2030-12-25", bookingStartTime: "12:00", bookingEndTime: "16:00", bookingGuestCount: 30 }),
  });
  assert.equal(conflict.response.status, 409);

  const token = await staffToken();
  const booking = state.bookings[0];
  const invalidEdit = await request(`/api/admin/bookings/${booking._id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bookingGuestCount: 1 }),
  });
  assert.equal(invalidEdit.response.status, 422);

  const pastEdit = await request(`/api/admin/bookings/${booking._id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bookingDate: dateOffset(-1) }),
  });
  assert.equal(pastEdit.response.status, 422);

  const expired = await request(`/api/admin/bookings/${booking._id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bookingStatus: "expired" }),
  });
  assert.equal(expired.response.status, 200);
  assert.equal(expired.body.booking.bookingStatus, "expired");
  assert.equal(state.slots.length, 0);
});

test("rejects disallowed browser origins", async () => {
  const result = await request("/api/menu", { headers: { Origin: "https://evil.example" } });
  assert.equal(result.response.status, 403);
  assert.equal(result.body.message, "Origin is not allowed.");
});

test("requires a Cloudflare Access assertion when production access is enabled", async () => {
  process.env.CF_ACCESS_ENABLED = "true";
  try {
    const result = await request("/api/admin/menu");
    assert.equal(result.response.status, 403);
    assert.equal(result.body.message, "Cloudflare Access authentication is required.");
  } finally {
    process.env.CF_ACCESS_ENABLED = "false";
  }
});
