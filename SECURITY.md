# ABCT security and privacy

## Data handling

- Customer names, phone numbers, email addresses, booking details, notes, and
  menu orders are private booking data.
- Public endpoints expose only available menu items. Admin booking and menu
  endpoints require a staff JWT and, in production, Cloudflare Access.
- Staff passwords are stored as bcrypt hashes and are never returned by the
  API. JWTs are stored only in the staff browser session and expire after eight
  hours.
- Deposit status is a staff-recorded off-platform status. No payment card or
  gateway data is collected by this application.
- The application has no automatic customer-data retention or deletion job.
  Booking documents are not deleted automatically. Function Hall slot records
  are technical availability records released when a booking becomes terminal;
  they do not contain customer contact details.

## Secret handling

- Never commit `.env`, MongoDB credentials, JWT secrets, Cloudflare Access
  secrets, or private Cloudinary credentials.
- Store production values in the hosting provider's encrypted environment
  variables.
- Rotate MongoDB passwords and JWT secrets immediately if they are exposed.
- Keep Cloudflare Access enabled in production and restrict the admin Pages
  application to authorized staff.

## Application protections

- Admin routes require a bearer JWT with the expected issuer, audience, HS256
  algorithm, and staff role, plus production Cloudflare Access. Public menu and
  booking routes are intentionally unauthenticated customer endpoints.
- The Pages API proxy uses a fixed HTTPS backend origin, removes browser
  cookies and spoofable forwarding headers, and forwards the signed Cloudflare
  Access assertion for server-side verification.
- Login and booking requests are rate-limited.
- Request bodies have a 100 KB limit and booking/menu fields are validated on
  the server.
- Malformed JSON and oversized bodies return controlled 4xx responses instead
  of leaking parser or database errors as 500 responses.
- MongoDB operator and dotted-key input is sanitized in request bodies,
  parameters, and queries before route handling.
- CORS allows only configured browser origins.
- Security headers are added to every response; private admin responses are
  marked `Cache-Control: no-store`.
- Cloudinary image URLs must use HTTPS delivery URLs from `res.cloudinary.com`.

## Operational checklist

Before production launch, verify HTTPS, MongoDB network restrictions, backups,
Cloudflare Access policy membership, CORS origins, rotated credentials, and
that logs do not contain passwords, JWTs, or unnecessary customer details.

Use `/healthz` as the process liveness check and `/readyz` as the MongoDB
readiness check. Alert on readiness failures and structured `request_error`
events from the backend logs. Production rate limits use MongoDB counters so
limits remain effective across multiple backend processes; local development
and unit tests use the in-memory fallback.

Run `npm run test:integration` with a disposable MongoDB replica-set URI before
launching. Run `npm run test:remote` with `SMOKE_BASE_URL` after each deployment
to verify the Pages proxy, CORS, public menu, and health endpoints. Run
`npm run test:remote:full` only with a short-lived admin JWT and, when the
admin host is Access-protected, a valid Access assertion/service-token setup;
otherwise the script must fail rather than silently skip protected checks.

## MongoDB Atlas production controls

These controls must be applied in the Atlas dashboard; they are not stored in
the repository:

1. **Backups.** For a dedicated M10+ cluster, enable Cloud Backup and
   Continuous Cloud Backup. Use a daily snapshot policy with a documented
   retention period and a point-in-time restore window appropriate for the
   business. Perform a restore test against a separate target cluster before
   launch. Free/shared tiers may not provide the same backup features; use an
   encrypted, scheduled `mongodump` to a separate protected store if Atlas
   Cloud Backup is unavailable.
2. **Network restrictions.** In Atlas **Security → Network Access**, remove
   `0.0.0.0/0`. From the Render service's **Connect → Outbound** panel, add
   the service's outbound CIDR ranges to Atlas. Use Render dedicated outbound
   IPs if a narrow, stable allowlist is required. Keep a developer IP entry
   temporary and time-limited.
3. **Least-privilege application user.** Create a dedicated production
   database user for the backend with only the built-in `readWrite` role on
   the application's database. Do not assign `atlasAdmin`, `dbAdmin`,
   `userAdmin`, `root`, or organization-level roles to the application user.
   Keep migration/administration credentials separate and out of the Render
   runtime. Confirm the database name in `MONGODB_URI` before changing it so
   an existing dataset is not accidentally bypassed.
4. **Rotation and review.** Store the user credentials only in Render's
   encrypted environment variables, rotate them after exposure or staff
   changes, and review Atlas Activity Feed entries for user, network, and
   backup-policy changes.

The Atlas guidance follows MongoDB's recommendations for backup policy,
network access lists, and least-privilege database roles.
