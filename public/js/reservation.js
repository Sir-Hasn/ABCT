const API_BASE_URL = window.ABCT_API_BASE_URL || "http://127.0.0.1:3101";
const bookingForm = document.querySelector("#booking-form");
const bookingType = document.querySelector("#booking-type");
const tableFields = document.querySelector("[data-table-fields]");
const tableMenuFields = document.querySelector("[data-table-menu-fields]");
const hallFields = document.querySelector("[data-hall-fields]");
const hallTimeFields = document.querySelector("[data-hall-times]");
const menuPickers = [...document.querySelectorAll("[data-menu-picker]")];
const formMessage = document.querySelector("#booking-message");
const successPanel = document.querySelector("#booking-success");
const submitButton = document.querySelector("#booking-submit");
const customerFields = [...document.querySelectorAll("#booking-form [data-customer-field]")];
let menuItems = [];
const menuSelections = new Map([
  ["table", new Map()],
  ["function-hall", new Map()],
]);
const menuPickerState = new Map(menuPickers.map((picker) => [picker.dataset.menuPicker, { search: "", category: "" }]));

// Prevent the browser from injecting a previously saved customer's contact
// details into a new reservation. Fields become editable when the guest
// focuses them; autocomplete remains disabled on the form and fields.
function armCustomerFields() {
  customerFields.forEach((field) => {
    field.readOnly = true;
    field.addEventListener("focus", () => { field.readOnly = false; });
  });
}
armCustomerFields();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

function normalizePhilippineMobile(value) {
  const compact = String(value || "").trim().replace(/[\s().-]/g, "");
  if (/^09\d{9}$/.test(compact)) return `+63${compact.slice(1)}`;
  if (/^\+639\d{9}$/.test(compact)) return compact;
  return null;
}

function showMessage(message, kind = "error") {
  if (!formMessage) return;
  formMessage.textContent = message;
  formMessage.dataset.kind = kind;
  formMessage.hidden = !message;
}

function manilaDateString() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function selectionFor(type) {
  if (!menuSelections.has(type)) menuSelections.set(type, new Map());
  return menuSelections.get(type);
}

function selectedMenuItems(type) {
  return [...selectionFor(type).entries()]
    .filter(([, quantity]) => Number.isInteger(quantity) && quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }));
}

function getFoodTotal(type) {
  return selectedMenuItems(type).reduce((total, selection) => {
    const item = menuItems.find((menuItem) => menuItem._id === selection.itemId);
    return total + (Number(item?.itemPrice) || 0) * selection.quantity;
  }, 0);
}

function setBookingType() {
  const isHall = bookingType.value === "function-hall";
  tableFields.hidden = isHall;
  tableMenuFields.hidden = isHall;
  hallFields.hidden = !isHall;
  hallTimeFields.hidden = !isHall;
  const tableTime = document.querySelector("[name=bookingTimeSlot]");
  const startTime = document.querySelector("#booking-start-time");
  const endTime = document.querySelector("#booking-end-time");
  if (tableTime) tableTime.required = !isHall;
  if (startTime) startTime.required = isHall;
  if (endTime) endTime.required = isHall;
  updateHallSummary();
  updateTableSummary();
}

function timeOptions(startHour = 8, endHour = 22) {
  return Array.from({ length: endHour - startHour + 1 }, (_, index) => {
    const hour = startHour + index;
    return `${String(hour).padStart(2, "0")}:00`;
  });
}

function populateTimes() {
  const start = document.querySelector("#booking-start-time");
  const end = document.querySelector("#booking-end-time");
  if (!start || !end) return;
  const options = timeOptions();
  const optionMarkup = options.map((value) => `<option value="${value}">${value}</option>`).join("");
  start.innerHTML = `<option value="">Select start time</option>${optionMarkup}`;
  end.innerHTML = `<option value="">Select end time</option>${optionMarkup}`;
}

function filteredMenuItems(type) {
  const state = menuPickerState.get(type) || { search: "", category: "" };
  const query = state.search.trim().toLowerCase();
  return menuItems.filter((item) => {
    const categoryMatches = !state.category || item.itemCategory === state.category;
    const searchable = `${item.itemName} ${item.itemDescription} ${item.itemCategory}`.toLowerCase();
    return categoryMatches && (!query || searchable.includes(query));
  });
}

function renderMenuResults(picker) {
  const type = picker.dataset.menuPicker;
  const results = picker.querySelector("[data-menu-results]");
  const count = picker.querySelector("[data-menu-count]");
  const items = filteredMenuItems(type);
  if (count) count.textContent = menuItems.length ? `${items.length} of ${menuItems.length} menu items shown` : "";
  if (!results) return;
  results.innerHTML = items.length
    ? items.map((item) => {
      const quantity = selectionFor(type).get(item._id) || 0;
      return `<div class="order-item" data-menu-order data-item-id="${escapeHtml(item._id)}">
        <div class="order-item-copy"><strong>${escapeHtml(item.itemName)}</strong><small>${escapeHtml(item.itemDescription)} · ${money(item.itemPrice)}</small><em>${escapeHtml(item.itemCategory)}</em></div>
        <label class="quantity-field">Qty <input type="number" data-quantity min="0" max="100" value="${quantity}" inputmode="numeric" aria-label="Quantity for ${escapeHtml(item.itemName)}"></label>
      </div>`;
    }).join("")
    : `<p class="field-note">${menuItems.length ? "No menu items match your search." : "Menu items are unavailable right now. You may still submit the reservation."}</p>`;
}

function renderSelectedOrder(picker) {
  const type = picker.dataset.menuPicker;
  const selected = selectedMenuItems(type)
    .map((selection) => ({ ...selection, item: menuItems.find((item) => item._id === selection.itemId) }))
    .filter((selection) => selection.item);
  const target = picker.querySelector("[data-menu-selected]");
  if (!target) return;
  target.innerHTML = selected.length
    ? `<div class="selected-order-head"><strong>Your order (${selected.length} item${selected.length === 1 ? "" : "s"})</strong><button type="button" class="text-button" data-clear-menu>Clear</button></div>
      ${selected.map(({ item, quantity }) => `<div class="selected-order-row"><span>${quantity} × ${escapeHtml(item.itemName)}</span><strong>${money(item.itemPrice * quantity)}</strong><button type="button" class="remove-order" data-remove-item="${escapeHtml(item._id)}" aria-label="Remove ${escapeHtml(item.itemName)}">×</button></div>`).join("")}`
    : "";
}

function renderCategories(picker) {
  const select = picker.querySelector("[data-menu-category]");
  if (!select) return;
  const type = picker.dataset.menuPicker;
  const current = menuPickerState.get(type)?.category || "";
  const categoryCounts = new Map();
  menuItems.forEach((item) => {
    if (item.itemCategory) categoryCounts.set(item.itemCategory, (categoryCounts.get(item.itemCategory) || 0) + 1);
  });
  const categories = [...categoryCounts.keys()].sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)} (${categoryCounts.get(category)})</option>`).join("")}`;
  select.value = categories.includes(current) ? current : "";
  menuPickerState.get(type).category = select.value;
}

function renderMenus() {
  menuPickers.forEach((picker) => {
    renderCategories(picker);
    renderMenuResults(picker);
    renderSelectedOrder(picker);
  });
  updateHallSummary();
  updateTableSummary();
}

function getHallHours() {
  const start = document.querySelector("#booking-start-time")?.value;
  const end = document.querySelector("#booking-end-time")?.value;
  if (!start || !end) return 0;
  return Number(end.slice(0, 2)) - Number(start.slice(0, 2));
}

function updateHallSummary() {
  const hallSummary = document.querySelector("#hall-summary");
  if (!hallSummary || bookingType?.value !== "function-hall") return;
  const hours = getHallHours();
  const extensionHours = Math.max(0, hours - 4);
  const extensionFee = extensionHours * 5000;
  const foodTotal = getFoodTotal("function-hall");
  const guests = Number(document.querySelector("#booking-guests")?.value || 0);
  const eligible = guests >= 30 || foodTotal >= 30000;
  hallSummary.innerHTML = `<div><span>Included time</span><strong>4 hours</strong></div>
    <div><span>Additional time</span><strong>${extensionHours} hour${extensionHours === 1 ? "" : "s"} · ${money(extensionFee)}</strong></div>
    <div><span>Menu order</span><strong>${money(foodTotal)}</strong></div>
    <p class="summary-rule ${eligible ? "is-valid" : ""}">${eligible ? "Your reservation meets the 30-guest or ₱30,000 menu requirement." : "At least 30 guests or a ₱30,000 menu total is required."}</p>`;
}

function updateTableSummary() {
  const tableSummary = document.querySelector("#table-summary");
  if (!tableSummary || bookingType?.value !== "table") return;
  const total = getFoodTotal("table");
  const deposit = Math.round(total * 0.2 * 100) / 100;
  tableSummary.innerHTML = total > 0
    ? `<div><span>Menu total</span><strong>${money(total)}</strong></div><div><span>Required deposit (20%)</span><strong>${money(deposit)}</strong></div><p class="summary-rule">Menu orders require at least 3 days' notice. Deposit payment is handled directly with ABCT staff off platform.</p>`
    : `<p class="field-note">No menu items selected. You may submit a regular table request without a deposit.</p>`;
}

function daysUntil(dateValue) {
  const today = Date.parse(`${manilaDateString()}T00:00:00Z`);
  const requested = Date.parse(`${dateValue}T00:00:00Z`);
  return Number.isFinite(requested) && Number.isFinite(today) ? Math.floor((requested - today) / (24 * 60 * 60 * 1000)) : -1;
}

function validateBooking() {
  const phoneInput = bookingForm.querySelector("[name=userPhone]");
  const normalizedPhone = normalizePhilippineMobile(phoneInput?.value);
  if (normalizedPhone) phoneInput.value = normalizedPhone;
  if (!bookingForm.reportValidity()) return false;
  if (!normalizedPhone) {
    showMessage("Enter a Philippine mobile number such as 09171234567 or +639171234567.");
    phoneInput?.focus();
    return false;
  }
  const type = bookingType.value;
  const date = document.querySelector("#booking-date").value;
  if (date < manilaDateString()) {
    showMessage("Choose today or a future date.");
    return false;
  }
  if (type === "function-hall") {
    if (getHallHours() < 4) {
      showMessage("Function Hall bookings must be at least 4 hours.");
      return false;
    }
    const guests = Number(document.querySelector("#booking-guests").value);
    if (guests < 30 && getFoodTotal(type) < 30000) {
      showMessage("Function Hall bookings need at least 30 guests or a ₱30,000 menu order total.");
      return false;
    }
  } else if (selectedMenuItems(type).length > 0 && daysUntil(date) < 3) {
    showMessage("Table bookings with menu orders must be requested at least 3 days in advance.");
    return false;
  }
  return true;
}

menuPickers.forEach((picker) => {
  const type = picker.dataset.menuPicker;
  picker.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-menu-toggle]");
    if (toggle) {
      const browser = picker.querySelector("[data-menu-browser]");
      const open = browser.hidden;
      browser.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.querySelector("span").textContent = open ? "−" : "+";
      return;
    }
    const remove = event.target.closest("[data-remove-item]");
    if (remove) {
      selectionFor(type).delete(remove.dataset.removeItem);
      renderMenuResults(picker);
      renderSelectedOrder(picker);
      updateHallSummary();
      updateTableSummary();
      return;
    }
    if (event.target.closest("[data-clear-menu]")) {
      selectionFor(type).clear();
      renderMenuResults(picker);
      renderSelectedOrder(picker);
      updateHallSummary();
      updateTableSummary();
    }
  });
  picker.addEventListener("input", (event) => {
    if (event.target.matches("[data-menu-search]")) {
      menuPickerState.get(type).search = event.target.value;
      renderMenuResults(picker);
      return;
    }
    if (event.target.matches("[data-quantity]")) {
      const item = event.target.closest("[data-menu-order]");
      const quantity = Math.min(100, Math.max(0, Number.parseInt(event.target.value, 10) || 0));
      if (quantity) selectionFor(type).set(item.dataset.itemId, quantity);
      else selectionFor(type).delete(item.dataset.itemId);
      event.target.value = quantity;
      renderSelectedOrder(picker);
      updateHallSummary();
      updateTableSummary();
    }
  });
  picker.querySelector("[data-menu-category]")?.addEventListener("change", (event) => {
    menuPickerState.get(type).category = event.target.value;
    renderMenuResults(picker);
  });
});

bookingType?.addEventListener("change", setBookingType);
document.querySelectorAll("#booking-start-time, #booking-end-time, #booking-guests").forEach((element) => element.addEventListener("input", updateHallSummary));
document.querySelector("#booking-date")?.setAttribute("min", manilaDateString());
populateTimes();
setBookingType();

async function loadMenu() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/menu`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || "Menu unavailable.");
    menuItems = Array.isArray(body.items) ? body.items : [];
  } catch {
    menuItems = [];
  }
  renderMenus();
}

loadMenu();

bookingForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  if (!validateBooking()) return;

  const formData = new FormData(bookingForm);
  const type = bookingType.value;
  const payload = {
    userFullName: formData.get("userFullName").trim(),
    userPhone: formData.get("userPhone").trim(),
    userEmail: formData.get("userEmail").trim(),
    bookingType: type,
    bookingDate: formData.get("bookingDate"),
    bookingGuestCount: Number(formData.get("bookingGuestCount")),
    bookingNotes: formData.get("bookingNotes").trim(),
    selectedMenuItems: selectedMenuItems(type),
  };

  if (type === "function-hall") {
    payload.bookingStartTime = formData.get("bookingStartTime");
    payload.bookingEndTime = formData.get("bookingEndTime");
  } else {
    payload.bookingTimeSlot = formData.get("bookingTimeSlot");
    if (!payload.selectedMenuItems.length) delete payload.selectedMenuItems;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Sending request…";
  try {
    const response = await fetch(`${API_BASE_URL}/api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.errors?.join(" ") || "Your booking could not be submitted.");
    bookingForm.hidden = true;
    successPanel.hidden = false;
    successPanel.querySelector("[data-booking-reference]").textContent = body.booking?.bookingID || "received";
  } catch (error) {
    showMessage(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Send booking request";
  }
});

document.querySelector("[data-new-booking]")?.addEventListener("click", () => {
  bookingForm.reset();
  customerFields.forEach((field) => { field.value = ""; field.readOnly = true; });
  menuSelections.forEach((selection) => selection.clear());
  menuPickerState.forEach((state) => { state.search = ""; state.category = ""; });
  menuPickers.forEach((picker) => {
    picker.querySelector("[data-menu-browser]").hidden = true;
    picker.querySelector("[data-menu-toggle]").setAttribute("aria-expanded", "false");
    picker.querySelector("[data-menu-toggle] span").textContent = "+";
  });
  bookingForm.hidden = false;
  successPanel.hidden = true;
  setBookingType();
  renderMenus();
});
