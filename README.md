# ABCT Restaurant Website

## Backend

The backend is an Express and MongoDB service for restaurant bookings, menu
items, and staff accounts.

The production admin pages load scripts from `admin/js/`. The root-level admin
scripts are UI-preview files and are not part of the production flow. The
production login validates the email format and required password fields in the
browser, then verifies the credentials through the backend before creating a
browser-tab session.

### Start it locally

1. Add `MONGODB_URI`, `JWT_SECRET`, and `PORT` to the project-root `.env` file.
2. In `backend`, run `npm start`.
3. Use an API client such as Postman to request the public endpoints below.

### Public endpoints

`GET /api/menu`

Returns available menu items in an `items` array. Example local URL:
`http://127.0.0.1:3101/api/menu`.

`POST /api/bookings`

Creates a pending booking request. Send JSON with `userFullName`, `userPhone`,
`userEmail`, `bookingType`, `bookingDate`, `bookingTimeSlot`, and
`bookingGuestCount`. Optional fields are `bookingStartTime`, `bookingEndTime`,
and `bookingNotes`.

Booking types are `table`, `table-with-food`, and `function-hall`. Requests are
limited to 10 per 15 minutes to reduce spam. Catering is arranged
directly with staff and does not create an online booking.

### Function Hall booking rules

Function Hall requests must provide whole-hour `bookingStartTime` and
`bookingEndTime` values and last at least four hours. Each hour after the first
four adds ₱5,000 to the recorded extension fee; no payment is processed online.

The request needs either at least 30 guests or a server-calculated menu order
total of at least ₱30,000. Send menu choices in `selectedMenuItems`, using this
shape:

```json
[
  { "itemId": "MONGODB_MENU_ITEM_ID", "quantity": 2 }
]
```

The server looks up current available menu prices and saves a price snapshot in
the booking. It atomically reserves each requested Function Hall hour, so
overlapping Function Hall requests receive `409 Conflict`. Table reservations
do not reserve time slots.

### Staff login

`POST /api/admin/login`

Send a JSON body containing `userEmail` and `password`. On success, the API
returns a JWT valid for eight hours. The admin dashboard must send it in this
header for every future protected request:

```text
Authorization: Bearer <token>
```

Login attempts are limited to 5 per 15 minutes. The API deliberately gives the
same response for an unknown email and an incorrect password.

### Protected admin booking endpoints

`GET /api/admin/bookings` returns up to 100 bookings. Add `?status=pending`,
`confirmed`, `expired`, or `cancelled` to filter the list.

`PATCH /api/admin/bookings/:bookingId` accepts `bookingStatus`,
`bookingDepositStatus`, and/or `bookingNotes`. An admin manually marks
uncompleted requests as `expired`. Setting a Function Hall booking to
`cancelled` or `expired` atomically releases its reserved hours.

### Protected menu endpoints

`GET /api/admin/menu` lists all menu items, including unavailable items.

`POST /api/admin/menu` creates an item. Required fields are `itemName`,
`itemDescription`, `itemPrice`, `itemCategory`, and `itemNumber`. Optional
fields are `itemPhotoUrl` and `itemAvailable`.

`PATCH /api/admin/menu/:itemId` updates item details, and
`PATCH /api/admin/menu/:itemId/availability` accepts `{ "itemAvailable": true }`
or `false`. A photo URL must be an HTTPS Cloudinary delivery URL. Staff upload
the image in Cloudinary first; this API stores only the resulting URL.

Admin routes require a JWT bearer token. In production they also require a
valid Cloudflare Access assertion. Set these Render environment variables:

```text
NODE_ENV=production
CF_ACCESS_ENABLED=true
CF_ACCESS_AUD=<Cloudflare Access application audience>
CF_ACCESS_DOMAIN=<your-team>.cloudflareaccess.com
```

Cloudflare Access checks are intentionally bypassed only while
`CF_ACCESS_ENABLED` is not `true`, for local development and Postman testing.

### Create the first admin

Run this one time from `backend` on a trusted computer:

```text
npm run create-admin
```

The script asks for the admin name, email, and a hidden password. It requires a
password of at least 12 characters, stores only its bcrypt hash, and refuses to
overwrite an existing staff email. Do not add a public staff-registration page.

### Data rules

- Every booking has customer contact details, a booking type/date/time, guest
  count, status, deposit status, and an automatic reference number.
- Every menu item has a name, description, price, category, availability, and
  unique item number.
- Staff passwords must be stored as bcrypt hashes; they are never returned by
  normal database queries.

### Customer phone numbers

Booking phone numbers must be Philippine mobile numbers. Customers may enter
the local form `09XXXXXXXXX` or international form `+639XXXXXXXXX`; spaces,
hyphens, and parentheses are accepted and normalized to the international
form. The same rule is enforced for staff edits.

## Public customer website

The `public/` folder is the customer-facing Cloudflare Pages site. It is
separate from the protected `admin/` staff site and does not expose the admin
dashboard.

The public pages use `window.ABCT_API_BASE_URL` to locate the backend. Local
development defaults to `http://127.0.0.1:3101`; set that value before a Pages
deployment so it points to the deployed API hostname.

- `menu.html` loads available menu items from `GET /api/menu`.
- `reservation.html` submits table and Function Hall requests to
  `POST /api/bookings`.
- Catering is contact-only: customers browse the menu and use the Facebook,
  phone, or email links rather than creating an online catering booking.
- Function Hall requests require at least four hours, charge ₱5,000 for every
  hour beyond four, and require at least 30 guests or a ₱30,000 menu total.

### Admin API URL

The production admin Pages site must use the deployed HTTPS backend URL. Set
`window.ABCT_API_BASE_URL` in `admin/js/api-config.js` after the backend is
deployed, for example:

```js
window.ABCT_API_BASE_URL = "https://api.example.com";
```

Local admin development continues to use `http://127.0.0.1:3101`. The Pages
site deliberately refuses to fall back to localhost, because a visitor's
browser would interpret that as the visitor's own computer.

### Test the public flow locally

1. Start the backend from `backend` with `npm start` and confirm MongoDB is
   reachable.
2. Serve `public/` with a static server (for example, VS Code Live Server).
3. Open `reservation.html`, submit a table request, then try a Function Hall
   request with fewer than 30 guests and less than ₱30,000 to confirm the
   validation message appears.
