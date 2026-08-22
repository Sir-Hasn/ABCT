const SESSION_KEY = "abct_admin_session";
const API_BASE_URL = window.ABCT_API_BASE_URL || "";

let sessionData;
try { sessionData = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { sessionData = null; }
if (!sessionData?.token) { window.location.replace("index.html"); throw new Error("An authenticated staff session is required."); }

const app = document.querySelector("#app");
const drawerRoot = document.querySelector("#drawer-root");
const modalRoot = document.querySelector("#modal-root");
const toastElement = document.querySelector("#toast");
const pageTitle = document.querySelector("#page-title");
const pageSubtitle = document.querySelector("#page-subtitle");
const dateChip = document.querySelector(".date-chip");
const state = { view: "overview", bookingFilter: "pending", bookingSearch: "", bookingDateMode: "all", bookingDateFilter: "", bookingSort: "priority", bookingPage: 1, bookingPageSize: 20, lastBookingsRefresh: null, menuSearch: "", menuCategory: "", bookings: [], menuItems: [] };
const bookingPoll = { timer: 0, inFlight: false, failures: 0 };
const BOOKING_POLL_INTERVAL = 20000;
const BOOKING_POLL_MAX_INTERVAL = 120000;

function updateCustomerLabels(root) {
  if (!root) return;
  root.querySelectorAll("th").forEach((cell) => {
    if (cell.textContent.trim() === "Guest") cell.textContent = "Customer";
  });
  root.querySelectorAll("label").forEach((label) => {
    for (const node of label.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() === "Guest name") {
        node.textContent = node.textContent.replace("Guest name", "Customer name");
      }
    }
  });
  root.querySelectorAll("input[placeholder]").forEach((input) => {
    input.placeholder = input.placeholder.replace(/\bguest\b/gi, "customer");
  });
}

const customerLabelObserver = new MutationObserver(() => {
  updateCustomerLabels(app);
  updateCustomerLabels(modalRoot);
});
customerLabelObserver.observe(app, { childList: true, subtree: true });
customerLabelObserver.observe(modalRoot, { childList: true, subtree: true });

function updateDateChip() {
  if (!dateChip) return;
  dateChip.textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date());
}
updateDateChip();

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const money = (value) => `₱${Number(value || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const dateOnly = (value) => value ? new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—";
const titleCase = (value) => String(value || "").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const bookingLabel = (booking) => booking.bookingType === "function-hall" ? "Function Hall" : titleCase(booking.bookingType);
const depositSummary = (booking) => booking.bookingDepositAmount > 0
  ? `${titleCase(booking.bookingDepositStatus || "unpaid")} · ${money(booking.bookingDepositAmount)} required`
  : titleCase(booking.bookingDepositStatus || "unpaid");

function showToast(message, kind = "success") {
  toastElement.textContent = message; toastElement.className = `toast show ${kind}`;
  window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => { toastElement.className = "toast"; }, 3200);
}
function signOut() { sessionStorage.removeItem(SESSION_KEY); window.location.replace("index.html"); }
async function api(path, options = {}) {
  if (!API_BASE_URL) throw new Error("The production API URL has not been configured yet.");
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.token}`, ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) { signOut(); throw new Error("Your session has expired. Please sign in again."); }
  if (!response.ok) throw new Error(body.message || "The request could not be completed.");
  return body;
}
function updateStaffCard() {
  const name = sessionData.user?.name || "Staff member"; const role = sessionData.user?.role || "staff";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "ST";
  document.querySelector(".staff-card strong").textContent = name; document.querySelector(".staff-card small").textContent = titleCase(role); document.querySelector(".staff-card .avatar").textContent = initials;
}
function setHeader(title, subtitle) { pageTitle.textContent = title; pageSubtitle.textContent = subtitle; document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view)); }
function statusBadge(status) { return `<span class="status ${escapeHtml(status)}">${escapeHtml(titleCase(status))}</span>`; }
function renderEmpty(title, message) { return `<div class="empty"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</div>`; }
function bookingSnapshot(bookings) {
  return JSON.stringify([...bookings].sort((left, right) => String(left._id).localeCompare(String(right._id))));
}
async function loadBookings({ signal } = {}) {
  const nextBookings = (await api("/api/admin/bookings", { signal })).bookings || [];
  const changed = bookingSnapshot(nextBookings) !== bookingSnapshot(state.bookings);
  state.bookings = nextBookings;
  state.lastBookingsRefresh = new Date();
  return changed;
}
async function loadMenu() { state.menuItems = (await api("/api/admin/menu")).items || []; }

function scheduleBookingPoll(delay = BOOKING_POLL_INTERVAL) {
  window.clearTimeout(bookingPoll.timer);
  if (!document.hidden) bookingPoll.timer = window.setTimeout(pollBookings, delay);
}
async function pollBookings() {
  if (document.hidden || bookingPoll.inFlight) return scheduleBookingPoll();
  bookingPoll.inFlight = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const changed = await loadBookings({ signal: controller.signal });
    bookingPoll.failures = 0;
    if (changed && state.view === "bookings") renderBookings();
    if (changed && state.view === "overview") renderOverview();
  } catch (error) {
    if (error?.name !== "AbortError" && !/session has expired/i.test(error?.message || "")) {
      bookingPoll.failures = Math.min(bookingPoll.failures + 1, 3);
    }
  } finally {
    window.clearTimeout(timeout);
    bookingPoll.inFlight = false;
    scheduleBookingPoll(Math.min(BOOKING_POLL_MAX_INTERVAL, BOOKING_POLL_INTERVAL * 2 ** bookingPoll.failures));
  }
}
function startBookingPolling() {
  if (API_BASE_URL) scheduleBookingPoll();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) window.clearTimeout(bookingPoll.timer);
  else { updateDateChip(); pollBookings(); }
});

function renderOverview() {
  setHeader("Overview", "A clear view of today’s service.");
  const pending = state.bookings.filter((item) => item.bookingStatus === "pending");
  const confirmed = state.bookings.filter((item) => item.bookingStatus === "confirmed");
  const halls = state.bookings.filter((item) => item.bookingType === "function-hall" && !["expired", "cancelled"].includes(item.bookingStatus));
  const todayCount = state.bookings.filter((item) => new Date(item.bookingDate).toDateString() === new Date().toDateString()).length;
  const attention = pending.slice(0, 6); const schedule = confirmed.slice(0, 6);
  app.innerHTML = `<section class="metrics"><article class="metric"><div class="metric-label">Pending review</div><div class="metric-value">${pending.length}</div><div class="metric-detail">Requests awaiting a decision</div></article><article class="metric"><div class="metric-label">Confirmed</div><div class="metric-value">${confirmed.length}</div><div class="metric-detail">Active confirmed bookings</div></article><article class="metric"><div class="metric-label">Today</div><div class="metric-value">${todayCount}</div><div class="metric-detail">Bookings on today’s date</div></article><article class="metric"><div class="metric-label">Function Hall</div><div class="metric-value">${halls.length}</div><div class="metric-detail">Active hall reservations</div></article></section><div class="section-grid"><section class="panel"><div class="panel-head"><h2 class="panel-title">Needs attention</h2><button class="btn-quiet" data-view="bookings">View all →</button></div><div class="attention-list">${attention.length ? attention.map((booking) => `<button class="attention-row" data-booking-id="${escapeHtml(booking._id)}"><span class="person">${escapeHtml(booking.userFullName)}<small>${escapeHtml(booking.bookingID)}</small></span><span class="booking-type">${escapeHtml(bookingLabel(booking))}<small class="row-muted">${dateOnly(booking.bookingDate)}</small></span>${statusBadge(booking.bookingStatus)}</button>`).join("") : renderEmpty("All caught up", "There are no pending bookings to review.")}</div></section><section class="panel"><div class="panel-head"><h2 class="panel-title">Upcoming schedule</h2><small>${confirmed.length} confirmed</small></div><div class="schedule-list">${schedule.length ? schedule.map((booking) => `<button class="schedule-row" data-booking-id="${escapeHtml(booking._id)}"><span class="time">${escapeHtml(booking.bookingStartTime || booking.bookingTimeSlot || "—")}</span><span class="hall"><strong>${escapeHtml(booking.userFullName)}</strong><span class="schedule-kind">${escapeHtml(bookingLabel(booking))} · ${dateOnly(booking.bookingDate)}</span></span>${statusBadge(booking.bookingStatus)}</button>`).join("") : renderEmpty("No schedule yet", "Confirmed bookings will appear here.")}</div></section></div>`;
}

function filteredBookings() {
  const query = state.bookingSearch.trim().toLowerCase();
  const priority = { pending: 0, confirmed: 1, expired: 2, cancelled: 3 };
  return state.bookings
    .filter((booking) => (state.bookingFilter === "all" || booking.bookingStatus === state.bookingFilter) && (!query || [booking.bookingID, booking.userFullName, booking.userEmail, booking.bookingType].some((value) => String(value || "").toLowerCase().includes(query))))
    .sort((left, right) => (priority[left.bookingStatus] ?? 99) - (priority[right.bookingStatus] ?? 99));
}
function renderBookings() {
  setHeader("Bookings", "Review requests and keep the schedule current."); const bookings = filteredBookings(); const filters = ["all", "pending", "confirmed", "expired", "cancelled"];
  app.innerHTML = `<div class="toolbar"><label class="search">⌕<input data-booking-search type="search" value="${escapeHtml(state.bookingSearch)}" placeholder="Search guest, email, or reference"></label><div class="filters">${filters.map((filter) => `<button class="filter-tab ${state.bookingFilter === filter ? "active" : ""}" data-filter="${filter}">${titleCase(filter)}</button>`).join("")}</div></div><section class="panel"><div class="panel-head"><h2 class="panel-title">All booking requests</h2><small>${bookings.length} shown</small></div><div class="table-wrap"><table class="booking-table"><thead><tr><th>Reference</th><th>Guest</th><th>Type</th><th>Date</th><th>Guests</th><th>Status</th><th></th></tr></thead><tbody>${bookings.length ? bookings.map((booking) => `<tr><td><span class="ref">${escapeHtml(booking.bookingID)}</span></td><td><strong>${escapeHtml(booking.userFullName)}</strong><small class="row-muted">${escapeHtml(booking.userEmail)}</small></td><td>${escapeHtml(bookingLabel(booking))}</td><td>${dateOnly(booking.bookingDate)}<small class="row-muted">${escapeHtml(booking.bookingStartTime || booking.bookingTimeSlot || "—")}</small></td><td>${escapeHtml(booking.bookingGuestCount)}</td><td>${statusBadge(booking.bookingStatus)}</td><td><button class="btn btn-secondary" data-booking-id="${escapeHtml(booking._id)}">Open</button></td></tr>`).join("") : `<tr><td colspan="7">${renderEmpty("No bookings found", "Try another filter or search term.")}</td></tr>`}</tbody></table></div></section>`;
}

function menuCards() {
  const query = state.menuSearch.trim().toLowerCase();
  const items = state.menuItems.filter((item) => (!query || `${item.itemName} ${item.itemDescription} ${item.itemCategory}`.toLowerCase().includes(query)) && (!state.menuCategory || item.itemCategory === state.menuCategory));
  return items.map((item) => `<article class="menu-card"><div class="dish-preview">${item.itemPhotoUrl ? `<img src="${escapeHtml(item.itemPhotoUrl)}" alt="${escapeHtml(item.itemName)}">` : `<span class="dish-placeholder">${escapeHtml((item.itemName || "?").slice(0, 1).toUpperCase())}</span>`}</div><div class="dish-content"><h3 class="dish-name">${escapeHtml(item.itemName)}</h3><p class="dish-meta"><span>${escapeHtml(item.itemCategory)}</span><span class="dish-price">${money(item.itemPrice)}</span></p><p class="row-muted">${escapeHtml(item.itemDescription)}</p><div class="availability-row"><span class="availability ${item.itemAvailable ? "available" : "unavailable"}">${item.itemAvailable ? "Available" : "Archived"}</span><label class="switch" title="Toggle availability"><input type="checkbox" data-menu-availability="${escapeHtml(item._id)}" ${item.itemAvailable ? "checked" : ""}><span class="slider"></span></label></div></div></article>`).join("") || renderEmpty("No menu items", "Add a menu item to make it available for booking.");
}
function renderMenu() {
  setHeader("Menu", "Manage the dishes available to guests."); const categories = [...new Set(state.menuItems.map((item) => item.itemCategory).filter(Boolean))].sort();
  app.innerHTML = `<div class="menu-toolbar"><label class="search">⌕<input data-menu-search type="search" placeholder="Search menu" value="${escapeHtml(state.menuSearch)}"></label><select class="select-control" data-menu-category><option value="">All categories</option>${categories.map((category) => `<option ${state.menuCategory === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select><button class="btn btn-primary" data-add-menu>Add menu item <span>＋</span></button></div><div class="menu-grid">${menuCards()}</div>`;
}

function normalizeMenuText(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}
function menuCards() {
  const query = normalizeMenuText(state.menuSearch);
  const category = normalizeMenuText(state.menuCategory);
  const items = state.menuItems.filter((item) => {
    const searchable = [item.itemNumber, item.itemName, item.itemDescription, item.itemCategory].map(normalizeMenuText).join(" ");
    return (!query || searchable.includes(query)) && (!category || normalizeMenuText(item.itemCategory) === category);
  });
  return items.map((item) => `<article class="menu-card"><div class="dish-preview">${item.itemPhotoUrl ? `<img src="${escapeHtml(item.itemPhotoUrl)}" alt="${escapeHtml(item.itemName)}">` : `<span class="dish-placeholder">${escapeHtml((item.itemName || "?").slice(0, 1).toUpperCase())}</span>`}</div><div class="dish-content"><h3 class="dish-name">${escapeHtml(item.itemName)}</h3><p class="dish-meta"><span>${escapeHtml(item.itemCategory)}</span><span class="dish-price">${money(item.itemPrice)}</span></p><p class="row-muted">${escapeHtml(item.itemDescription)}</p><div class="availability-row"><span class="availability ${item.itemAvailable ? "available" : "unavailable"}">${item.itemAvailable ? "Available" : "Archived"}</span><label class="switch" title="Toggle availability"><input type="checkbox" data-menu-availability="${escapeHtml(item._id)}" ${item.itemAvailable ? "checked" : ""}><span class="slider"></span></label></div></div></article>`).join("") || renderEmpty("No menu items", "Try another search or category.");
}
function renderMenu() {
  setHeader("Menu", "Manage the dishes available to guests.");
  const categoryMap = new Map();
  state.menuItems.forEach((item) => {
    const label = String(item.itemCategory ?? "").trim();
    const key = normalizeMenuText(label);
    if (key && !categoryMap.has(key)) categoryMap.set(key, label);
  });
  const categories = [...categoryMap.entries()].sort((left, right) => left[1].localeCompare(right[1], undefined, { sensitivity: "base" }));
  app.innerHTML = `<div class="menu-toolbar"><label class="search">⌕<input data-menu-search type="search" placeholder="Search item number, name, category" value="${escapeHtml(state.menuSearch)}"></label><select class="select-control" data-menu-category><option value="">All categories</option>${categories.map(([key, label]) => `<option value="${escapeHtml(label)}" ${normalizeMenuText(state.menuCategory) === key ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select><button class="btn btn-primary" data-add-menu>Add menu item <span>＋</span></button></div><div class="menu-grid">${menuCards()}</div>`;
}

function openBookingDrawer(id) {
  const booking = state.bookings.find((item) => item._id === id); if (!booking) return;
  const orders = booking.foodOrders || [];
  drawerRoot.innerHTML = `<div class="drawer-backdrop" data-close-drawer><aside class="drawer" role="dialog" aria-label="Booking details"><div class="drawer-head"><div><p class="eyebrow">${escapeHtml(booking.bookingID)}</p><h2 class="panel-title">${escapeHtml(booking.userFullName)}</h2><small>${escapeHtml(bookingLabel(booking))}</small></div><button class="close-btn" data-close-drawer aria-label="Close">×</button></div><div class="drawer-body"><div class="detail-grid"><div><span class="detail-label">Status</span><div class="detail-value">${statusBadge(booking.bookingStatus)}</div></div><div><span class="detail-label">Deposit</span><div class="detail-value">${escapeHtml(depositSummary(booking))}</div></div><div><span class="detail-label">Date</span><div class="detail-value">${dateOnly(booking.bookingDate)}</div></div><div><span class="detail-label">Time</span><div class="detail-value">${escapeHtml(booking.bookingStartTime || booking.bookingTimeSlot || "—")} ${booking.bookingEndTime ? `– ${escapeHtml(booking.bookingEndTime)}` : ""}</div></div><div><span class="detail-label">Contact</span><div class="detail-value">${escapeHtml(booking.userEmail)}<br>${escapeHtml(booking.userPhone)}</div></div><div><span class="detail-label">Guests</span><div class="detail-value">${escapeHtml(booking.bookingGuestCount)}</div></div></div>${orders.length ? `<section class="detail-section"><h4>Menu order</h4>${orders.map((order) => `<div class="order-row"><span>${escapeHtml(order.quantity)} × ${escapeHtml(order.itemName)}</span><strong>${money(order.subtotal)}</strong></div>`).join("")}<div class="totals"><span>Total</span><span>${money(booking.foodOrderTotal)}</span></div></section>` : ""}<section class="detail-section"><h4>Notes</h4><p class="row-muted">${escapeHtml(booking.bookingNotes || "No notes provided.")}</p></section><div class="action-row">${booking.bookingStatus === "pending" ? `<button class="btn btn-primary" data-update-booking="confirmed" data-booking-id="${escapeHtml(booking._id)}">Confirm</button><button class="btn btn-danger" data-update-booking="cancelled" data-booking-id="${escapeHtml(booking._id)}">Cancel</button>` : ""}${booking.bookingStatus === "confirmed" ? `<button class="btn btn-secondary" data-update-booking="expired" data-booking-id="${escapeHtml(booking._id)}">Mark expired</button>` : ""}</div></div></aside></div>`;
}
function openMenuModal() {
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><form class="modal-card" id="menu-form"><div class="modal-head"><div><p class="eyebrow">Menu management</p><h2 class="modal-title">Add menu item</h2></div><button type="button" class="close-btn" data-close-modal>×</button></div><div class="form-grid"><label class="field">Item number<input name="itemNumber" required maxlength="30" placeholder="M-001"></label><label class="field">Name<input name="itemName" required maxlength="120" placeholder="Dish name"></label><label class="field">Category<input name="itemCategory" required maxlength="60" placeholder="Main course"></label><label class="field">Price (PHP)<input name="itemPrice" required min="0" step="0.01" type="number" placeholder="0.00"></label><label class="field full">Description<textarea name="itemDescription" required maxlength="1000" placeholder="Describe the dish"></textarea></label><label class="field full">Cloudinary image URL<input name="itemPhotoUrl" type="url" placeholder="https://res.cloudinary.com/..."></label></div><div class="action-row"><button type="button" class="btn btn-secondary" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Save item</button></div></form></div>`;
}
async function setView(view) {
  state.view = view;
  closeMobileRail();
  app.innerHTML = `<div class="empty"><strong>Loading…</strong>Please wait.</div>`;
  try { if (view === "menu") { await loadMenu(); renderMenu(); } else { await loadBookings(); view === "bookings" ? renderBookings() : renderOverview(); } } catch (error) { app.innerHTML = `<div class="banner">${escapeHtml(error.message)}</div>`; }
}

document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view]"); if (viewButton) return setView(viewButton.dataset.view);
  if (event.target.closest("[data-review]")) return setView("bookings");
  if (event.target.closest("[data-signout]")) return signOut();
  if (event.target.closest("[data-help]")) return showToast("Use Bookings to review requests, or Menu to manage dishes.", "warning");
  const bookingButton = event.target.closest("button[data-booking-id]:not([data-update-booking])"); if (bookingButton) return openBookingDrawer(bookingButton.dataset.bookingId);
  const drawerClose = event.target.closest("[data-close-drawer]");
  if (drawerClose && (event.target === drawerClose || event.target.closest(".close-btn"))) { drawerRoot.innerHTML = ""; return; }
  const modalClose = event.target.closest("[data-close-modal]");
  if (modalClose && (event.target === modalClose || event.target.closest(".close-btn"))) { modalRoot.innerHTML = ""; return; }
  const filter = event.target.closest("[data-filter]"); if (filter) { state.bookingFilter = filter.dataset.filter; return renderBookings(); }
  const update = event.target.closest("[data-update-booking]");
  if (update) { try { await api(`/api/admin/bookings/${update.dataset.bookingId}`, { method: "PATCH", body: JSON.stringify({ bookingStatus: update.dataset.updateBooking }) }); await loadBookings(); drawerRoot.innerHTML = ""; showToast("Booking updated."); state.view === "bookings" ? renderBookings() : renderOverview(); } catch (error) { showToast(error.message, "warning"); } return; }
  if (event.target.closest("[data-add-menu]")) return openMenuModal();
});
document.addEventListener("input", (event) => {
  if (event.target.matches("[data-booking-search]")) {
    state.bookingSearch = event.target.value; state.bookingPage = 1; renderBookings();
    const next = document.querySelector("[data-booking-search]"); next?.focus(); next?.setSelectionRange(state.bookingSearch.length, state.bookingSearch.length);
  }
  if (event.target.matches("[data-menu-search]")) {
    state.menuSearch = event.target.value; renderMenu();
    const next = document.querySelector("[data-menu-search]"); next?.focus(); next?.setSelectionRange(state.menuSearch.length, state.menuSearch.length);
  }
});
document.addEventListener("change", async (event) => {
  if (event.target.matches("[data-menu-category]")) { state.menuCategory = event.target.value; renderMenu(); return; }
  if (!event.target.matches("[data-menu-availability]")) return;
  try { await api(`/api/admin/menu/${event.target.dataset.menuAvailability}/availability`, { method: "PATCH", body: JSON.stringify({ itemAvailable: event.target.checked }) }); const item = state.menuItems.find((entry) => entry._id === event.target.dataset.menuAvailability); if (item) item.itemAvailable = event.target.checked; showToast(event.target.checked ? "Menu item restored." : "Menu item archived."); renderMenu(); } catch (error) { event.target.checked = !event.target.checked; showToast(error.message, "warning"); }
});
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "menu-form") return; event.preventDefault(); const payload = Object.fromEntries(new FormData(event.target).entries()); payload.itemPrice = Number(payload.itemPrice); payload.itemAvailable = true;
  try { await api("/api/admin/menu", { method: "POST", body: JSON.stringify(payload) }); modalRoot.innerHTML = ""; await loadMenu(); showToast("Menu item added."); renderMenu(); } catch (error) { showToast(error.message, "warning"); }
});

// Bookings workspace enhancements: status counts, date/sort controls,
// compact accessible rows, manual refresh, and bounded pagination.
const bookingStatusOrder = { pending: 0, confirmed: 1, expired: 2, cancelled: 3 };
const manilaDateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });

function manilaDateKey(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return manilaDateFormatter.format(date);
}

function todayManilaKey() { return manilaDateKey(new Date()); }
function bookingScheduleValue(booking) {
  const date = String(booking.bookingDate || "").slice(0, 10);
  const time = String(booking.bookingStartTime || booking.bookingTimeSlot || "23:59").slice(0, 5);
  const timestamp = Date.parse(`${date}T${time}:00+08:00`);
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
}
function bookingRequestValue(booking) {
  const timestamp = Date.parse(booking.createdAt || booking.updatedAt || "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
function shortBookingReference(value) {
  const reference = String(value || "");
  return reference.length > 24 ? `${reference.slice(0, 11)}…${reference.slice(-9)}` : reference;
}
function bookingStatusCounts() {
  return state.bookings.reduce((counts, booking) => {
    const status = booking.bookingStatus || "pending";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, { all: state.bookings.length, pending: 0, confirmed: 0, expired: 0, cancelled: 0 });
}
function bookingMatchesDate(booking) {
  const date = manilaDateKey(booking.bookingDate);
  if (state.bookingDateMode === "today") return date === todayManilaKey();
  if (state.bookingDateMode === "upcoming") return date >= todayManilaKey();
  if (state.bookingDateMode === "specific") return !state.bookingDateFilter || date === state.bookingDateFilter;
  return true;
}

filteredBookings = function () {
  const query = state.bookingSearch.trim().toLowerCase();
  const filtered = state.bookings.filter((booking) => {
    const matchesStatus = state.bookingFilter === "all" || booking.bookingStatus === state.bookingFilter;
    const matchesSearch = !query || [booking.bookingID, booking.userFullName, booking.userEmail, booking.bookingType]
      .some((value) => String(value || "").toLowerCase().includes(query));
    return matchesStatus && matchesSearch && bookingMatchesDate(booking);
  });
  return filtered.sort((left, right) => {
    if (state.bookingSort === "newest") return bookingRequestValue(right) - bookingRequestValue(left);
    if (state.bookingSort === "soonest") return bookingScheduleValue(left) - bookingScheduleValue(right);
    if (state.bookingSort === "customer") return String(left.userFullName || "").localeCompare(String(right.userFullName || ""));
    return (bookingStatusOrder[left.bookingStatus] ?? 99) - (bookingStatusOrder[right.bookingStatus] ?? 99) || bookingScheduleValue(left) - bookingScheduleValue(right);
  });
};

function refreshLabel() {
  if (!state.lastBookingsRefresh) return "Not refreshed yet";
  const elapsed = Math.max(0, Date.now() - state.lastBookingsRefresh.getTime());
  if (elapsed < 60_000) return "Updated just now";
  return `Updated ${state.lastBookingsRefresh.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`;
}
function renderBookingPagination(total) {
  const totalPages = Math.max(1, Math.ceil(total / state.bookingPageSize));
  state.bookingPage = Math.min(Math.max(1, state.bookingPage), totalPages);
  const first = total ? (state.bookingPage - 1) * state.bookingPageSize + 1 : 0;
  const last = Math.min(state.bookingPage * state.bookingPageSize, total);
  return `<div class="booking-pagination" aria-label="Booking pages"><span class="booking-page-info">Showing ${first}-${last} of ${total}</span><div class="booking-page-actions"><button class="btn btn-secondary booking-page-button" type="button" data-booking-page="prev" ${state.bookingPage <= 1 ? "disabled" : ""} aria-label="Previous page">Previous</button><span class="booking-page-number" aria-live="polite">Page ${state.bookingPage} of ${totalPages}</span><button class="btn btn-secondary booking-page-button" type="button" data-booking-page="next" ${state.bookingPage >= totalPages ? "disabled" : ""} aria-label="Next page">Next</button></div></div>`;
}

renderBookings = function () {
  setHeader("Bookings", "Review requests and keep the schedule current.");
  const allFiltered = filteredBookings();
  const totalPages = Math.max(1, Math.ceil(allFiltered.length / state.bookingPageSize));
  state.bookingPage = Math.min(Math.max(1, state.bookingPage), totalPages);
  const start = (state.bookingPage - 1) * state.bookingPageSize;
  const bookings = allFiltered.slice(start, start + state.bookingPageSize);
  const counts = bookingStatusCounts();
  const filters = ["all", "pending", "confirmed", "expired", "cancelled"];
  const dateMode = state.bookingDateMode;
  const dateButton = (mode, label) => `<button class="date-filter ${dateMode === mode ? "active" : ""}" type="button" data-booking-date-mode="${mode}" aria-pressed="${dateMode === mode}">${label}</button>`;
  const tableRows = bookings.map((booking) => {
    const id = booking._id || booking.bookingID;
    const customer = booking.userFullName || "Customer";
    const schedule = booking.bookingStartTime || booking.bookingTimeSlot || "—";
    return `<tr class="booking-row" tabindex="0" role="button" data-booking-row data-booking-id="${escapeHtml(id)}" aria-label="Open booking for ${escapeHtml(customer)}"><td><div class="booking-reference"><span class="ref" title="${escapeHtml(booking.bookingID)}">${escapeHtml(shortBookingReference(booking.bookingID))}</span><button class="copy-reference" type="button" data-copy-reference="${escapeHtml(booking.bookingID)}" aria-label="Copy booking reference">Copy</button></div></td><td><strong title="${escapeHtml(customer)}">${escapeHtml(customer)}</strong><small class="row-muted" title="${escapeHtml(booking.userEmail)}">${escapeHtml(booking.userEmail)}</small></td><td><span>${escapeHtml(bookingLabel(booking))}</span><small class="row-muted">${escapeHtml(booking.bookingGuestCount)} guests</small></td><td><span>${escapeHtml(dateOnly(booking.bookingDate))}</span><small class="row-muted">${escapeHtml(schedule)}${booking.bookingEndTime ? ` – ${escapeHtml(booking.bookingEndTime)}` : ""}</small></td><td>${statusBadge(booking.bookingStatus)}</td><td><button class="btn btn-secondary" type="button" data-booking-id="${escapeHtml(id)}">Open</button></td></tr>`;
  }).join("");
  app.innerHTML = `<div class="booking-workspace"><div class="booking-toolbar"><div class="booking-toolbar-top"><label class="search booking-search" aria-label="Search bookings">⌕<input data-booking-search type="search" value="${escapeHtml(state.bookingSearch)}" placeholder="Search customer, email, or reference"></label><div class="booking-date-controls" role="group" aria-label="Booking date filters">${dateButton("today", "Today")}${dateButton("upcoming", "Upcoming")}${dateButton("all", "All dates")}<label class="specific-date"><span>Specific date</span><input type="date" data-booking-date value="${escapeHtml(state.bookingDateFilter)}" aria-label="Filter by specific date"></label></div><label class="booking-sort">Sort<select data-booking-sort aria-label="Sort bookings"><option value="priority" ${state.bookingSort === "priority" ? "selected" : ""}>Status priority</option><option value="newest" ${state.bookingSort === "newest" ? "selected" : ""}>Newest request</option><option value="soonest" ${state.bookingSort === "soonest" ? "selected" : ""}>Soonest reservation</option><option value="customer" ${state.bookingSort === "customer" ? "selected" : ""}>Customer name</option></select></label><button class="btn btn-secondary booking-refresh" type="button" data-bookings-refresh>Refresh</button><span class="booking-last-updated" data-bookings-updated aria-live="polite">${refreshLabel()}</span></div><div class="booking-tabs" role="tablist" aria-label="Booking status">${filters.map((filter) => `<button class="filter-tab ${state.bookingFilter === filter ? "active" : ""}" type="button" data-booking-filter="${filter}" role="tab" aria-selected="${state.bookingFilter === filter}">${titleCase(filter)} <span class="tab-count">${counts[filter] || 0}</span></button>`).join("")}</div></div><section class="panel"><div class="panel-head"><div><h2 class="panel-title">Booking requests</h2><p class="booking-context">Pending requests are shown first for quick review.</p></div><small>${allFiltered.length} shown</small></div><div class="table-wrap"><table class="booking-table" aria-label="Booking requests"><caption class="sr-only">Customer reservation booking requests</caption><thead><tr><th>Reference</th><th>Customer</th><th>Reservation</th><th>Schedule</th><th>Status</th><th>Action</th></tr></thead><tbody>${tableRows || `<tr><td colspan="6">${renderEmpty("No bookings found", "Try another status, date, or search term.")}</td></tr>`}</tbody></table></div>${renderBookingPagination(allFiltered.length)}</section></div>`;
};

function resetBookingPage() { state.bookingPage = 1; }
async function refreshBookingsFromUi(button) {
  if (bookingPoll.inFlight) return;
  bookingPoll.inFlight = true;
  button.disabled = true;
  try {
    const changed = await loadBookings();
    bookingPoll.failures = 0;
    if (state.view === "bookings") renderBookings();
    showToast(changed ? "Bookings refreshed." : "Bookings are up to date.");
  } catch (error) {
    showToast(error.message, "warning");
  } finally {
    bookingPoll.inFlight = false;
    button.disabled = false;
    scheduleBookingPoll();
  }
}
async function copyReference(value) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else throw new Error("clipboard unavailable");
    showToast("Booking reference copied.");
  } catch {
    showToast("Copy is unavailable in this browser.", "warning");
  }
}

// Capture cancellation/expiration before the legacy action listener can send
// the request, so destructive status changes always require confirmation.
document.addEventListener("click", (event) => {
  const update = event.target.closest("[data-update-booking]");
  if (!update || !["cancelled", "expired"].includes(update.dataset.updateBooking)) return;
  const label = update.dataset.updateBooking === "cancelled" ? "cancel this booking" : "mark this booking expired";
  if (!window.confirm(`Are you sure you want to ${label}?`)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

document.addEventListener("click", async (event) => {
  const filter = event.target.closest("[data-booking-filter]");
  if (filter) { state.bookingFilter = filter.dataset.bookingFilter; resetBookingPage(); return renderBookings(); }
  const dateMode = event.target.closest("[data-booking-date-mode]");
  if (dateMode) { state.bookingDateMode = dateMode.dataset.bookingDateMode; if (state.bookingDateMode !== "specific") state.bookingDateFilter = ""; resetBookingPage(); return renderBookings(); }
  const refresh = event.target.closest("[data-bookings-refresh]");
  if (refresh) return refreshBookingsFromUi(refresh);
  const pageButton = event.target.closest("[data-booking-page]");
  if (pageButton && !pageButton.disabled) { state.bookingPage += pageButton.dataset.bookingPage === "next" ? 1 : -1; return renderBookings(); }
  const copyButton = event.target.closest("[data-copy-reference]");
  if (copyButton) { event.stopPropagation(); return copyReference(copyButton.dataset.copyReference); }
  const row = event.target.closest("tr[data-booking-row]");
  if (row && !event.target.closest("button,a")) return openBookingDrawer(row.dataset.bookingId);
});
document.addEventListener("keydown", (event) => {
  const row = event.target.closest?.("tr[data-booking-row]");
  if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openBookingDrawer(row.dataset.bookingId); }
});
document.addEventListener("input", (event) => {
  if (!event.target.matches("[data-booking-search]")) return;
  state.bookingSearch = event.target.value;
  resetBookingPage();
});
document.addEventListener("change", (event) => {
  if (event.target.matches("[data-booking-sort]")) { state.bookingSort = event.target.value; resetBookingPage(); renderBookings(); return; }
  if (event.target.matches("[data-booking-date]")) { state.bookingDateFilter = event.target.value; state.bookingDateMode = event.target.value ? "specific" : "all"; resetBookingPage(); renderBookings(); }
});

// Keep the function-hall time inputs quoted correctly for browsers that parse
// the modal markup strictly.
function openBookingEditModal(id) {
  const booking = state.bookings.find((item) => item._id === id);
  if (!booking) return;
  const date = String(booking.bookingDate || "").slice(0, 10);
  const scheduleFields = booking.bookingType === "function-hall"
    ? `<label class="field">Start time<input name="bookingStartTime" required type="time" step="3600" value="${escapeHtml(booking.bookingStartTime || "")}"></label><label class="field">End time<input name="bookingEndTime" required type="time" step="3600" value="${escapeHtml(booking.bookingEndTime || "")}"></label>`
    : `<label class="field">Time slot<input name="bookingTimeSlot" required value="${escapeHtml(booking.bookingTimeSlot || "")}"></label>`;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><form class="modal-card" id="booking-edit-form" data-booking-id="${escapeHtml(booking._id)}"><div class="modal-head"><div><p class="eyebrow">${escapeHtml(booking.bookingID)}</p><h2 class="modal-title">Edit reservation</h2></div><button type="button" class="close-btn" data-close-modal>×</button></div><div class="form-grid"><label class="field">Guest name<input name="userFullName" required maxlength="100" value="${escapeHtml(booking.userFullName)}"></label><label class="field">Phone<input name="userPhone" required maxlength="30" value="${escapeHtml(booking.userPhone)}"></label><label class="field">Email<input name="userEmail" required type="email" value="${escapeHtml(booking.userEmail)}"></label><label class="field">Guests<input name="bookingGuestCount" required min="1" max="500" type="number" value="${escapeHtml(booking.bookingGuestCount)}"></label><label class="field">Date<input name="bookingDate" required type="date" value="${escapeHtml(date)}"></label>${scheduleFields}<label class="field">Deposit<select name="bookingDepositStatus"><option value="unpaid" ${booking.bookingDepositStatus === "unpaid" ? "selected" : ""}>Unpaid</option><option value="paid" ${booking.bookingDepositStatus === "paid" ? "selected" : ""}>Paid</option><option value="refunded" ${booking.bookingDepositStatus === "refunded" ? "selected" : ""}>Refunded</option></select></label><label class="field full">Notes<textarea name="bookingNotes" maxlength="1000">${escapeHtml(booking.bookingNotes || "")}</textarea></label></div><div class="action-row"><button type="button" class="btn btn-secondary" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Save changes</button></div></form></div>`;
}

// Final definition used by the edit action (kept separate from the legacy
// preview markup so function-hall time fields always have valid attributes).
function openBookingEditModal(id) {
  const booking = state.bookings.find((item) => item._id === id);
  if (!booking) return;
  const date = String(booking.bookingDate || "").slice(0, 10);
  const scheduleFields = booking.bookingType === "function-hall"
    ? `<label class="field">Start time<input name="bookingStartTime" required type="time" step="3600" value="${escapeHtml(booking.bookingStartTime || "")}"></label><label class="field">End time<input name="bookingEndTime" required type="time" step="3600" value="${escapeHtml(booking.bookingEndTime || "")}"></label>`
    : `<label class="field">Time slot<input name="bookingTimeSlot" required value="${escapeHtml(booking.bookingTimeSlot || "")}"></label>`;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><form class="modal-card" id="booking-edit-form" data-booking-id="${escapeHtml(booking._id)}"><div class="modal-head"><div><p class="eyebrow">${escapeHtml(booking.bookingID)}</p><h2 class="modal-title">Edit reservation</h2></div><button type="button" class="close-btn" data-close-modal>×</button></div><div class="form-grid"><label class="field">Guest name<input name="userFullName" required maxlength="100" value="${escapeHtml(booking.userFullName)}"></label><label class="field">Phone<input name="userPhone" required maxlength="30" value="${escapeHtml(booking.userPhone)}"></label><label class="field">Email<input name="userEmail" required type="email" value="${escapeHtml(booking.userEmail)}"></label><label class="field">Guests<input name="bookingGuestCount" required min="1" max="500" type="number" value="${escapeHtml(booking.bookingGuestCount)}"></label><label class="field">Date<input name="bookingDate" required type="date" value="${escapeHtml(date)}"></label>${scheduleFields}<label class="field">Deposit<select name="bookingDepositStatus"><option value="unpaid" ${booking.bookingDepositStatus === "unpaid" ? "selected" : ""}>Unpaid</option><option value="paid" ${booking.bookingDepositStatus === "paid" ? "selected" : ""}>Paid</option><option value="refunded" ${booking.bookingDepositStatus === "refunded" ? "selected" : ""}>Refunded</option></select></label><label class="field full">Notes<textarea name="bookingNotes" maxlength="1000">${escapeHtml(booking.bookingNotes || "")}</textarea></label></div><div class="action-row"><button type="button" class="btn btn-secondary" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Save changes</button></div></form></div>`;
}
function closeMobileRail() {
  if (!window.matchMedia("(max-width: 760px)").matches) return;
  const rail = document.querySelector("#rail");
  const mobileMenu = document.querySelector("#mobile-menu");
  rail.style.display = "none";
  mobileMenu?.setAttribute("aria-expanded", "false");
}

document.querySelector("#mobile-menu")?.addEventListener("click", () => {
  const rail = document.querySelector("#rail");
  const isOpen = rail.style.display === "flex";
  rail.style.display = isOpen ? "none" : "flex";
  document.querySelector("#mobile-menu")?.setAttribute("aria-expanded", String(!isOpen));
});

updateStaffCard(); dateChip.textContent = new Date().toLocaleDateString("en-PH", { weekday: "short", day: "2-digit", month: "long", year: "numeric" }); setView("overview"); startBookingPolling();

// Pending bookings can also be manually expired. The initial drawer markup
// contains the confirm/cancel actions, so append this action after it opens.
document.addEventListener("click", (event) => {
  const bookingButton = event.target.closest("button[data-booking-id]:not([data-update-booking])");
  if (!bookingButton) return;
  const booking = state.bookings.find((item) => item._id === bookingButton.dataset.bookingId);
  if (!booking) return;
  const actionRow = drawerRoot.querySelector(".action-row");
  if (booking.bookingStatus === "pending" && actionRow && !actionRow.querySelector('[data-update-booking="expired"]')) {
    actionRow.insertAdjacentHTML("beforeend", `<button class="btn btn-secondary" data-update-booking="expired" data-booking-id="${escapeHtml(booking._id)}">Mark expired</button>`);
  }
  if (actionRow && !actionRow.querySelector("[data-edit-booking]")) {
    actionRow.insertAdjacentHTML("beforeend", `<button class="btn btn-secondary" data-edit-booking="${escapeHtml(booking._id)}">Edit reservation</button>`);
  }
});

// Override the earlier preview-compatible definition with strict modal markup.
openBookingEditModal = function (id) {
  const booking = state.bookings.find((item) => item._id === id);
  if (!booking) return;
  const date = String(booking.bookingDate || "").slice(0, 10);
  const scheduleFields = booking.bookingType === "function-hall"
    ? `<label class="field">Start time<input name="bookingStartTime" required type="time" step="3600" value="${escapeHtml(booking.bookingStartTime || "")}"></label><label class="field">End time<input name="bookingEndTime" required type="time" step="3600" value="${escapeHtml(booking.bookingEndTime || "")}"></label>`
    : `<label class="field">Time slot<input name="bookingTimeSlot" required value="${escapeHtml(booking.bookingTimeSlot || "")}"></label>`;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><form class="modal-card" id="booking-edit-form" data-booking-id="${escapeHtml(booking._id)}"><div class="modal-head"><div><p class="eyebrow">${escapeHtml(booking.bookingID)}</p><h2 class="modal-title">Edit reservation</h2></div><button type="button" class="close-btn" data-close-modal>×</button></div><div class="form-grid"><label class="field">Guest name<input name="userFullName" required maxlength="100" value="${escapeHtml(booking.userFullName)}"></label><label class="field">Phone<input name="userPhone" required maxlength="30" value="${escapeHtml(booking.userPhone)}"></label><label class="field">Email<input name="userEmail" required type="email" value="${escapeHtml(booking.userEmail)}"></label><label class="field">Guests<input name="bookingGuestCount" required min="1" max="500" type="number" value="${escapeHtml(booking.bookingGuestCount)}"></label><label class="field">Date<input name="bookingDate" required type="date" value="${escapeHtml(date)}"></label>${scheduleFields}<label class="field">Deposit<select name="bookingDepositStatus"><option value="unpaid" ${booking.bookingDepositStatus === "unpaid" ? "selected" : ""}>Unpaid</option><option value="paid" ${booking.bookingDepositStatus === "paid" ? "selected" : ""}>Paid</option><option value="refunded" ${booking.bookingDepositStatus === "refunded" ? "selected" : ""}>Refunded</option></select></label><label class="field full">Notes<textarea name="bookingNotes" maxlength="1000">${escapeHtml(booking.bookingNotes || "")}</textarea></label></div><div class="action-row"><button type="button" class="btn btn-secondary" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Save changes</button></div></form></div>`;
};

function decorateMenuCards() {
  document.querySelectorAll(".menu-card").forEach((card) => {
    const availability = card.querySelector("[data-menu-availability]");
    const row = card.querySelector(".availability-row");
    if (!availability || !row || row.querySelector("[data-edit-menu]")) return;
    const editButton = document.createElement("button");
    editButton.className = "btn-quiet";
    editButton.dataset.editMenu = availability.dataset.menuAvailability;
    editButton.textContent = "Edit";
    row.insertBefore(editButton, row.firstChild);
  });
}

const menuCardObserver = new MutationObserver(decorateMenuCards);
menuCardObserver.observe(app, { childList: true, subtree: true });
decorateMenuCards();

function openMenuEditModal(id) {
  const item = state.menuItems.find((entry) => entry._id === id);
  if (!item) return;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><form class="modal-card" id="menu-edit-form" data-item-id="${escapeHtml(item._id)}"><div class="modal-head"><div><p class="eyebrow">Menu management</p><h2 class="modal-title">Edit menu item</h2></div><button type="button" class="close-btn" data-close-modal>×</button></div><div class="form-grid"><label class="field">Item number<input name="itemNumber" required maxlength="30" value="${escapeHtml(item.itemNumber)}"></label><label class="field">Name<input name="itemName" required maxlength="120" value="${escapeHtml(item.itemName)}"></label><label class="field">Category<input name="itemCategory" required maxlength="60" value="${escapeHtml(item.itemCategory)}"></label><label class="field">Price (PHP)<input name="itemPrice" required min="0" step="0.01" type="number" value="${escapeHtml(item.itemPrice)}"></label><label class="field full">Description<textarea name="itemDescription" required maxlength="1000">${escapeHtml(item.itemDescription)}</textarea></label><label class="field full">Cloudinary image URL<input name="itemPhotoUrl" type="url" value="${escapeHtml(item.itemPhotoUrl || "")}"></label></div><div class="action-row"><button type="button" class="btn btn-secondary" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Save changes</button></div></form></div>`;
}

function openBookingEditModal(id) {
  const booking = state.bookings.find((item) => item._id === id);
  if (!booking) return;
  const date = String(booking.bookingDate || "").slice(0, 10);
  const functionHall = booking.bookingType === "function-hall";
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><form class="modal-card" id="booking-edit-form" data-booking-id="${escapeHtml(booking._id)}"><div class="modal-head"><div><p class="eyebrow">${escapeHtml(booking.bookingID)}</p><h2 class="modal-title">Edit reservation</h2></div><button type="button" class="close-btn" data-close-modal>×</button></div><div class="form-grid"><label class="field">Guest name<input name="userFullName" required maxlength="100" value="${escapeHtml(booking.userFullName)}"></label><label class="field">Phone<input name="userPhone" required maxlength="30" value="${escapeHtml(booking.userPhone)}"></label><label class="field">Email<input name="userEmail" required type="email" value="${escapeHtml(booking.userEmail)}"></label><label class="field">Guests<input name="bookingGuestCount" required min="1" max="500" type="number" value="${escapeHtml(booking.bookingGuestCount)}"></label><label class="field">Date<input name="bookingDate" required type="date" value="${escapeHtml(date)}"></label>${functionHall ? `<label class="field">Start time<input name="bookingStartTime" required type="time" step="3600" value="${escapeHtml(booking.bookingStartTime || "")}></label><label class="field">End time<input name="bookingEndTime" required type="time" step="3600" value="${escapeHtml(booking.bookingEndTime || "")}></label>` : `<label class="field">Time slot<input name="bookingTimeSlot" required value="${escapeHtml(booking.bookingTimeSlot || "")}></label>`}<label class="field">Deposit<select name="bookingDepositStatus"><option value="unpaid" ${booking.bookingDepositStatus === "unpaid" ? "selected" : ""}>Unpaid</option><option value="paid" ${booking.bookingDepositStatus === "paid" ? "selected" : ""}>Paid</option><option value="refunded" ${booking.bookingDepositStatus === "refunded" ? "selected" : ""}>Refunded</option></select></label><label class="field full">Notes<textarea name="bookingNotes" maxlength="1000">${escapeHtml(booking.bookingNotes || "")}</textarea></label></div><div class="action-row"><button type="button" class="btn btn-secondary" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Save changes</button></div></form></div>`;
}

document.addEventListener("click", (event) => {
  const menuEdit = event.target.closest("[data-edit-menu]");
  if (menuEdit) return openMenuEditModal(menuEdit.dataset.editMenu);
  const bookingEdit = event.target.closest("[data-edit-booking]");
  if (bookingEdit) return openBookingEditModal(bookingEdit.dataset.editBooking);
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "menu-edit-form") {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.target).entries());
    payload.itemPrice = Number(payload.itemPrice);
    try {
      await api(`/api/admin/menu/${event.target.dataset.itemId}`, { method: "PATCH", body: JSON.stringify(payload) });
      modalRoot.innerHTML = ""; await loadMenu(); renderMenu(); showToast("Menu item updated.");
    } catch (error) { showToast(error.message, "warning"); }
  }
  if (event.target.id === "booking-edit-form") {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.target).entries());
    payload.bookingGuestCount = Number(payload.bookingGuestCount);
    try {
      await api(`/api/admin/bookings/${event.target.dataset.bookingId}`, { method: "PATCH", body: JSON.stringify(payload) });
      modalRoot.innerHTML = ""; await loadBookings(); openBookingDrawer(event.target.dataset.bookingId); showToast("Reservation updated.");
    } catch (error) { showToast(error.message, "warning"); }
  }
});
