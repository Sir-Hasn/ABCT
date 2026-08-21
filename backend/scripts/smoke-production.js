/*
 * Read-only production smoke checks. Run with:
 *   SMOKE_BASE_URL=https://abct-public.pages.dev npm run test:remote
 *   SMOKE_BACKEND_URL=https://abct.onrender.com  # optional direct CORS check
 *
 * Optional protected-admin check variables:
 *   SMOKE_ADMIN_BASE_URL=https://admin.example.com
 *   SMOKE_ADMIN_TOKEN=<short-lived staff JWT>
 *   SMOKE_CF_ACCESS_ASSERTION=<short-lived Cloudflare Access assertion>
 *   SMOKE_CF_ACCESS_CLIENT_ID=<Cloudflare Access service-token ID>
 *   SMOKE_CF_ACCESS_CLIENT_SECRET=<Cloudflare Access service-token secret>
 *
 * Add --require-admin (or set SMOKE_REQUIRE_ADMIN=true) to fail unless the
 * protected admin check is executed.
 */

const baseUrl = String(process.env.SMOKE_BASE_URL || "").trim().replace(/\/+$/, "");
const origin = String(process.env.SMOKE_ORIGIN || "https://abct-public.pages.dev").trim();

if (!baseUrl) {
  console.error("SMOKE_BASE_URL is required.");
  process.exit(1);
}

const parsedBaseUrl = new URL(baseUrl);
if (parsedBaseUrl.protocol !== "https:") {
  console.error("SMOKE_BASE_URL must use HTTPS.");
  process.exit(1);
}

async function check(path, options = {}) {
  const url = `${baseUrl}${path}`;
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    const reason = error.cause?.code || error.cause?.message || error.message;
    throw new Error(`${options.method || "GET"} ${url} failed: ${reason}`);
  }
  const raw = await response.text();
  let body = {};
  try { body = JSON.parse(raw); } catch { /* Report the raw fallback body below. */ }
  return { response, body, raw };
}

const failures = [];
const requireAdmin = process.argv.includes("--require-admin") || process.env.SMOKE_REQUIRE_ADMIN === "true";
let adminSmokeSkipped = false;
function expect(condition, message) {
  if (!condition) failures.push(message);
}

function expectJson(result, label) {
  const contentType = result.response.headers.get("content-type") || "missing content type";
  const preview = result.raw.replace(/\s+/g, " ").slice(0, 160);
  expect(contentType.includes("application/json"), `${label} returned ${result.response.status} ${contentType}: ${preview}`);
}

try {
  const health = await check("/api/healthz");
  expectJson(health, "/api/healthz");
  expect(health.response.status === 200, `/api/healthz returned ${health.response.status}`);
  expect(health.body.status === "ok", "/api/healthz did not return status=ok");

  const ready = await check("/api/readyz");
  expectJson(ready, "/api/readyz");
  expect(ready.response.status === 200, `/api/readyz returned ${ready.response.status}`);
  expect(ready.body.status === "ready", "/api/readyz did not return status=ready");

  const menu = await check("/api/menu");
  expectJson(menu, "/api/menu");
  expect(menu.response.status === 200, `/api/menu returned ${menu.response.status}`);
  expect(Array.isArray(menu.body.items), "/api/menu did not return an items array");

  const invalidBooking = await check("/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      userFullName: "Smoke Test Invalid Request",
      userPhone: "09171234567",
      userEmail: "smoke@example.com",
      bookingType: "table",
      bookingDate: "2000-01-01",
      bookingTimeSlot: "18:00",
      bookingGuestCount: 1,
    }),
  });
  expectJson(invalidBooking, "/api/bookings");
  expect(
    invalidBooking.response.status === 422,
    `/api/bookings validation returned ${invalidBooking.response.status}: ${invalidBooking.body.message || invalidBooking.raw.replace(/\s+/g, " ").slice(0, 160)}`,
  );

  // Pages requests are same-origin and do not need an ACAO header. When a
  // direct backend URL is supplied, verify that the backend CORS policy still
  // permits the public Pages origin.
  const backendUrl = String(process.env.SMOKE_BACKEND_URL || "").trim().replace(/\/+$/, "");
  if (backendUrl) {
    let backendMenu;
    try {
      backendMenu = await fetch(`${backendUrl}/api/menu`, { headers: { Origin: origin } });
    } catch (error) {
      const reason = error.cause?.code || error.cause?.message || error.message;
      throw new Error(`GET ${backendUrl}/api/menu failed: ${reason}`);
    }
    const backendRaw = await backendMenu.text();
    expect(backendMenu.status === 200, `direct backend /api/menu returned ${backendMenu.status}`);
    expect(backendMenu.headers.get("access-control-allow-origin") === origin, "Direct backend CORS origin header is incorrect");
    expect(backendMenu.headers.get("content-type")?.includes("application/json"), `direct backend /api/menu returned non-JSON content: ${backendRaw.replace(/\s+/g, " ").slice(0, 160)}`);
  }

  const adminBaseUrl = String(process.env.SMOKE_ADMIN_BASE_URL || "").trim().replace(/\/+$/, "");
  const adminToken = String(process.env.SMOKE_ADMIN_TOKEN || "").trim();
  const cfAccessAssertion = String(process.env.SMOKE_CF_ACCESS_ASSERTION || "").trim();
  const cfAccessClientId = String(process.env.SMOKE_CF_ACCESS_CLIENT_ID || "").trim();
  const cfAccessClientSecret = String(process.env.SMOKE_CF_ACCESS_CLIENT_SECRET || "").trim();
  if (adminBaseUrl) {
    expect(!adminBaseUrl.includes("["), "SMOKE_ADMIN_BASE_URL must be a plain HTTPS URL, not Markdown link text");
    expect(adminToken.length > 0, "SMOKE_ADMIN_TOKEN is required when SMOKE_ADMIN_BASE_URL is set");
    const hasAccessAssertion = cfAccessAssertion.length > 0;
    const hasAccessServiceToken = cfAccessClientId.length > 0 && cfAccessClientSecret.length > 0;
    expect(hasAccessAssertion || hasAccessServiceToken, "Provide SMOKE_CF_ACCESS_ASSERTION or both Cloudflare Access service-token variables when SMOKE_ADMIN_BASE_URL is set");

    try {
      const adminUrl = new URL(adminBaseUrl);
      expect(adminUrl.protocol === "https:", "SMOKE_ADMIN_BASE_URL must use HTTPS");
      if (adminToken && (hasAccessAssertion || hasAccessServiceToken) && adminUrl.protocol === "https:") {
        const headers = {
          Authorization: `Bearer ${adminToken}`,
        };
        if (hasAccessAssertion) headers["Cf-Access-Jwt-Assertion"] = cfAccessAssertion;
        if (hasAccessServiceToken) {
          headers["CF-Access-Client-Id"] = cfAccessClientId;
          headers["CF-Access-Client-Secret"] = cfAccessClientSecret;
        }
        let bookings;
        try {
          bookings = await fetch(`${adminBaseUrl}/api/admin/bookings`, { headers });
        } catch (error) {
          const reason = error.cause?.code || error.cause?.message || error.message;
          throw new Error(`GET ${adminBaseUrl}/api/admin/bookings failed: ${reason}`);
        }
        expect(bookings.status === 200, `/api/admin/bookings returned ${bookings.status}`);
      }
    } catch (error) {
      failures.push(`SMOKE_ADMIN_BASE_URL is invalid: ${error.message}`);
    }
  } else {
    adminSmokeSkipped = true;
    if (requireAdmin) {
      failures.push("Protected admin smoke was required but SMOKE_ADMIN_BASE_URL was not set");
    }
  }
} catch (error) {
  failures.push(error.message);
}

if (failures.length) {
  console.error("Production smoke test failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

if (adminSmokeSkipped) {
  console.log("Public production smoke checks passed; protected admin checks were not run.");
} else {
  console.log("Production smoke test passed, including the protected admin check.");
}
