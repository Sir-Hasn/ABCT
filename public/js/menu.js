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
  const category = String(item.itemCategory || "other").toLowerCase();
  return `<article class="dish-card public-menu-card" data-menu-card data-category="${escapeHtml(category)}">
    <div class="dish-image ${imageUrl ? "dish-image-photo" : "dish-sushi"}">
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.itemName)}" loading="lazy">` : `<span>${escapeHtml((item.itemName || "ABCT").slice(0, 1).toUpperCase())}</span>`}
    </div>
    <div class="dish-meta"><div><h3>${escapeHtml(item.itemName)}</h3><p>${escapeHtml(item.itemDescription)}</p></div><strong>${money(item.itemPrice)}</strong></div>
  </article>`;
}

function renderFilters(items) {
  const categories = [...new Set(items.map((item) => String(item.itemCategory || "other").toLowerCase()))].sort();
  document.querySelectorAll("[data-menu-filters]").forEach((container) => {
    container.innerHTML = ["all", ...categories]
      .map((category, index) => `<button class="filter ${index === 0 ? "active" : ""}" data-filter="${escapeHtml(category)}">${category === "all" ? "All plates" : escapeHtml(titleCase(category))}</button>`)
      .join("");
  });
}

async function loadMenu() {
  const grids = [...document.querySelectorAll("[data-menu-grid]")];
  if (!grids.length) return;

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
    });
  } catch (error) {
    grids.forEach((grid) => {
      if (grid.children.length === 0 || grid.id === "full-menu-grid") {
        grid.innerHTML = `<div class="public-error"><strong>Menu unavailable</strong><span>${escapeHtml(error.message)}</span><button class="button button-outline" type="button" data-retry-menu>Try again</button></div>`;
      }
    });
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-retry-menu]")) loadMenu();
});

loadMenu();
