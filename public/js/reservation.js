const API_BASE_URL = window.ABCT_API_BASE_URL || "http://127.0.0.1:3101";
const bookingForm = document.querySelector("#booking-form");
const bookingType = document.querySelector("#booking-type");
const tableFields = document.querySelector("[data-table-fields]");
const hallFields = document.querySelector("[data-hall-fields]");
const hallTimeFields = document.querySelector("[data-hall-times]");
const hallMenu = document.querySelector("#hall-menu");
const hallSummary = document.querySelector("#hall-summary");
const formMessage = document.querySelector("#booking-message");
const successPanel = document.querySelector("#booking-success");
const submitButton = document.querySelector("#booking-submit");
let menuItems = [];

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

function setBookingType() {
  const isHall = bookingType.value === "function-hall";
  tableFields.hidden = isHall;
  hallFields.hidden = !isHall;
  hallTimeFields.hidden = !isHall;
  const tableTime = document.querySelector("[name=bookingTimeSlot]");
  const startTime = document.querySelector("#booking-start-time");
  const endTime = document.querySelector("#booking-end-time");
  if (tableTime) tableTime.required = !isHall;
  if (startTime) startTime.required = isHall;
  if (endTime) endTime.required = isHall;
  document.querySelectorAll("[data-hall-only]").forEach((element) => { element.hidden = !isHall; });
  updateHallSummary();
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

function renderHallMenu() {
  if (!hallMenu) return;
  hallMenu.innerHTML = menuItems.length
    ? menuItems.map((item) => `<div class="order-item" data-menu-order data-item-id="${escapeHtml(item._id)}" data-price="${Number(item.itemPrice) || 0}">
        <div><strong>${escapeHtml(item.itemName)}</strong><small>${escapeHtml(item.itemDescription)} · ${money(item.itemPrice)}</small></div>
        <label>Qty <input type="number" data-quantity min="0" max="100" value="0" inputmode="numeric" aria-label="Quantity for ${escapeHtml(item.itemName)}"></label>
      </div>`).join("")
    : `<p class="field-note">Menu items will appear here when the public menu is available. You may still qualify with at least 30 guests.</p>`;
}

function getHallHours() {
  const start = document.querySelector("#booking-start-time")?.value;
  const end = document.querySelector("#booking-end-time")?.value;
  if (!start || !end) return 0;
  return (Number(end.slice(0, 2)) - Number(start.slice(0, 2)));
}

function getFoodTotal() {
  return [...document.querySelectorAll("[data-menu-order]")].reduce((total, item) => {
    const quantity = Number(item.querySelector("[data-quantity]")?.value || 0);
    return total + ((Number(item.dataset.price) || 0) * Math.max(0, quantity));
  }, 0);
}

function updateHallSummary() {
  if (!hallSummary || bookingType?.value !== "function-hall") return;
  const hours = getHallHours();
  const extensionHours = Math.max(0, hours - 4);
  const extensionFee = extensionHours * 5000;
  const foodTotal = getFoodTotal();
  const guests = Number(document.querySelector("#booking-guests")?.value || 0);
  const eligible = guests >= 30 || foodTotal >= 30000;
  hallSummary.innerHTML = `<div><span>Included time</span><strong>4 hours</strong></div>
    <div><span>Additional time</span><strong>${extensionHours} hour${extensionHours === 1 ? "" : "s"} · ${money(extensionFee)}</strong></div>
    <div><span>Menu order</span><strong>${money(foodTotal)}</strong></div>
    <p class="summary-rule ${eligible ? "is-valid" : ""}">${eligible ? "Your reservation meets the 30-guest or ₱30,000 menu requirement." : "At least 30 guests or a ₱30,000 menu total is required."}</p>`;
}

function selectedMenuItems() {
  return [...document.querySelectorAll("[data-menu-order]")]
    .map((item) => ({ itemId: item.dataset.itemId, quantity: Number(item.querySelector("[data-quantity]")?.value || 0) }))
    .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);
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
    const hours = getHallHours();
    const guests = Number(document.querySelector("#booking-guests").value);
    const foodTotal = getFoodTotal();
    if (hours < 4) {
      showMessage("Function Hall bookings must be at least 4 hours.");
      return false;
    }
    if (guests < 30 && foodTotal < 30000) {
      showMessage("Function Hall bookings need at least 30 guests or a ₱30,000 menu order total.");
      return false;
    }
  }
  return true;
}

async function loadHallMenu() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/menu`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || "Menu unavailable.");
    menuItems = Array.isArray(body.items) ? body.items : [];
    renderHallMenu();
  } catch {
    menuItems = [];
    renderHallMenu();
  }
}

bookingType?.addEventListener("change", setBookingType);
document.querySelectorAll("#booking-start-time, #booking-end-time, #booking-guests").forEach((element) => element.addEventListener("input", updateHallSummary));
hallMenu?.addEventListener("input", updateHallSummary);
document.querySelector("#booking-date")?.setAttribute("min", manilaDateString());
populateTimes();
setBookingType();
loadHallMenu();

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
  };

  if (type === "function-hall") {
    payload.bookingStartTime = formData.get("bookingStartTime");
    payload.bookingEndTime = formData.get("bookingEndTime");
    payload.selectedMenuItems = selectedMenuItems();
  } else {
    payload.bookingTimeSlot = formData.get("bookingTimeSlot");
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
  bookingForm.hidden = false;
  successPanel.hidden = true;
  setBookingType();
  updateHallSummary();
});
