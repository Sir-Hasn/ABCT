const API_BASE_URL = window.ABCT_API_BASE_URL || "http://127.0.0.1:3101";

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

function titleCase(value) {
  return String(value || "")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function itemCode(item) {
  const raw = String(item.itemNumber || item.itemCode || item.itemId || item.id || "");
  const digits = raw.replace(/\D/g, "");
  return digits ? digits.padStart(3, "0") : "";
}

function fallbackMarkup(item, failed = false) {
  const label = failed ? "Photo unavailable" : "Photo coming soon";
  const code = itemCode(item) || "—";
  return `<div class="dish-photo-fallback" role="img" aria-label="${escapeHtml(item.itemName || "ABCT menu item")} — ${label}">
    <span class="fallback-number">${escapeHtml(code)}</span>
    <span class="fallback-mark">ABCT</span>
    <strong class="fallback-name">${escapeHtml(item.itemName || "ABCT menu item")}</strong>
    <small>${label} · ${escapeHtml(titleCase(item.itemCategory || "menu item"))}</small>
  </div>`;
}

function safePhotoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com" ? url.href : "";
  } catch {
    return "";
  }
}

function renderCard(item) {
  const imageUrl = safePhotoUrl(item.itemPhotoUrl);
  const code = itemCode(item);
  const isPanoramic = code === "015" || item.itemPhotoOrientation === "landscape" || item.itemPhotoRatio === "wide";
  const category = String(item.itemCategory || "other").toLowerCase();
  const image = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.itemName)}" loading="lazy" data-menu-photo data-fallback="${escapeHtml(fallbackMarkup(item, true))}">${fallbackMarkup(item, true)}`
    : fallbackMarkup(item);
  return `<article class="dish-card public-menu-card ${isPanoramic ? "public-menu-card-wide" : ""}" data-menu-card data-category="${escapeHtml(category)}" data-item-code="${escapeHtml(code)}">
    <div class="dish-image dish-image-photo ${imageUrl ? "" : "dish-image-placeholder"}">
      ${image}
    </div>
    <div class="dish-meta"><div>${code ? `<span class="dish-item-code">${escapeHtml(code)}</span>` : ""}<h3>${escapeHtml(item.itemName)}</h3><p>${escapeHtml(item.itemDescription)}</p></div><strong>${money(item.itemPrice)}</strong></div>
  </article>`;
}

function renderFilters(items) {
  const categories = [...new Set(items.map((item) => String(item.itemCategory || "other").toLowerCase()))].sort();
  document.querySelectorAll("[data-menu-filters]").forEach((container) => {
    container.innerHTML = ["all", ...categories]
      .map((category, index) => `<button class="filter ${index === 0 ? "active" : ""}" data-filter="${escapeHtml(category)}" role="tab" aria-selected="${index === 0}">${category === "all" ? "All plates" : escapeHtml(titleCase(category))}</button>`)
      .join("");
  });
}

function bindPhotoFallbacks() {
  document.querySelectorAll("[data-menu-photo]").forEach((photo) => {
    photo.addEventListener("error", () => {
      const wrapper = photo.closest(".dish-image");
      if (!wrapper || wrapper.dataset.photoFailed === "true") return;
      wrapper.dataset.photoFailed = "true";
      photo.hidden = true;
      const fallback = document.createElement("div");
      fallback.innerHTML = photo.dataset.fallback || "";
      if (fallback.firstElementChild) wrapper.append(fallback.firstElementChild);
      wrapper.classList.add("dish-image-placeholder");
    }, { once: true });
  });
}

function renderSkeletons(grids) {
  const skeleton = () => `<article class="dish-card public-menu-skeleton" aria-hidden="true">
    <div class="skeleton-block skeleton-image"></div>
    <div class="skeleton-meta"><div><span class="skeleton-block skeleton-title"></span><span class="skeleton-block skeleton-line"></span><span class="skeleton-block skeleton-line skeleton-line-short"></span></div><span class="skeleton-block skeleton-price"></span></div>
  </article>`;

  grids.forEach((grid) => {
    const limit = Number(grid.dataset.limit || 0);
    const count = limit > 0 ? limit : 6;
    grid.setAttribute("aria-busy", "true");
    grid.setAttribute("aria-label", "Loading menu items");
    grid.innerHTML = Array.from({ length: count }, skeleton).join("");
  });
}

async function loadMenu() {
  const grids = [...document.querySelectorAll("[data-menu-grid]")];
  if (!grids.length) return;

  renderSkeletons(grids);

  try {
    const response = await fetch(`${API_BASE_URL}/api/menu`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || "The menu could not be loaded.");
    const items = Array.isArray(body.items) ? body.items : [];
    renderFilters(items);

    grids.forEach((grid) => {
      const limit = Number(grid.dataset.limit || 0);
      const visibleItems = limit > 0 ? items.slice(0, limit) : items;
      grid.innerHTML = visibleItems.length
        ? visibleItems.map(renderCard).join("")
        : `<div class="public-empty"><strong>The menu is being refreshed.</strong><span>Please check back soon.</span></div>`;
      grid.removeAttribute("aria-busy");
      grid.removeAttribute("aria-label");
    });
    bindPhotoFallbacks();
  } catch (error) {
    grids.forEach((grid) => {
      grid.innerHTML = `<div class="public-error"><strong>Menu unavailable</strong><span>${escapeHtml(error.message)}</span><button class="button button-outline" type="button" data-retry-menu>Try again</button></div>`;
      grid.removeAttribute("aria-busy");
      grid.removeAttribute("aria-label");
    });
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-retry-menu]")) loadMenu();
});

loadMenu();
