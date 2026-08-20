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

## Secret handling

- Never commit `.env`, MongoDB credentials, JWT secrets, Cloudflare Access
  secrets, or private Cloudinary credentials.
- Store production values in the hosting provider's encrypted environment
  variables.
- Rotate MongoDB passwords and JWT secrets immediately if they are exposed.
- Keep Cloudflare Access enabled in production and restrict the admin Pages
  application to authorized staff.

## Application protections

- Admin routes require bearer authentication and production Cloudflare Access.
- The Pages API proxy uses a fixed HTTPS backend origin, removes browser
  cookies and spoofable forwarding headers, and forwards the signed Cloudflare
  Access assertion for server-side verification.
- Login and booking requests are rate-limited.
- Request bodies have a 100 KB limit and booking/menu fields are validated on
  the server.
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
to verify the Pages proxy, CORS, public menu, and health endpoints.
