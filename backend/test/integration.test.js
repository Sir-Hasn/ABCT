import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";

const testUri = process.env.MONGODB_TEST_URI;

if (!testUri) {
  test("MongoDB replica-set integration suite", { skip: "Set MONGODB_TEST_URI to a disposable replica-set database." }, () => {});
} else {
  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = testUri;
  process.env.JWT_SECRET = "integration-test-secret-that-is-long-enough";
  process.env.CF_ACCESS_ENABLED = "false";

  const { app } = await import("../server/server.js");
  const { Bookings } = await import("../server/models/Booking.js");
  const { BookingSlot } = await import("../server/models/BookingSlot.js");
  const { Items } = await import("../server/models/MenuItem.js");

  let server;
  let baseUrl;
  const menuItemId = new mongoose.Types.ObjectId();

  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  }

  before(async () => {
    await mongoose.connect(testUri);
    await Promise.all([
      Bookings.deleteMany({}),
      BookingSlot.deleteMany({}),
      Items.deleteMany({ itemNumber: /^INTEGRATION-/ }),
    ]);
    await Items.create({
      _id: menuItemId,
      itemNumber: `INTEGRATION-${Date.now()}`,
      itemName: "Integration Ramen",
      itemDescription: "Disposable integration-test item.",
      itemPrice: 1250,
      itemCategory: "Integration",
      itemAvailable: true,
    });
    await BookingSlot.init();
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await Promise.all([
        Bookings.deleteMany({}),
        BookingSlot.deleteMany({}),
        Items.deleteMany({ itemNumber: /^INTEGRATION-/ }),
      ]);
      await mongoose.disconnect();
    }
  });

  test("uses liveness/readiness endpoints and enforces real slot uniqueness", async () => {
    const health = await request("/healthz");
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.body, { status: "ok" });

    const ready = await request("/readyz");
    assert.equal(ready.response.status, 200);
    assert.deepEqual(ready.body, { status: "ready" });

    const menu = await request("/api/menu");
    assert.equal(menu.response.status, 200);
    assert.ok(menu.body.items.some((item) => item._id === menuItemId.toString()));

    const first = await request("/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        userFullName: "Integration Hall Customer",
        userPhone: "09171234567",
        userEmail: "integration@example.com",
        bookingType: "function-hall",
        bookingDate: "2035-12-25",
        bookingStartTime: "10:00",
        bookingEndTime: "15:00",
        bookingGuestCount: 30,
      }),
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.body.booking.functionHallExtensionFee, 5000);

    const conflict = await request("/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        userFullName: "Integration Conflict Customer",
        userPhone: "09171234567",
        userEmail: "conflict@example.com",
        bookingType: "function-hall",
        bookingDate: "2035-12-25",
        bookingStartTime: "12:00",
        bookingEndTime: "16:00",
        bookingGuestCount: 30,
      }),
    });
    assert.equal(conflict.response.status, 409);
  });
}
