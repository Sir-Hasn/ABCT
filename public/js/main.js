const toast = document.querySelector("#toast");

function showToast(message, kind = "default") {
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

const menuToggle = document.querySelector("#menu-toggle");
const mainNav = document.querySelector("#main-nav");
if (menuToggle && mainNav) {
  menuToggle.addEventListener("click", () => {
    const isOpen = mainNav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  });

  mainNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    mainNav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  }));
}

document.querySelectorAll("[data-open-reservation]").forEach((button) => {
  button.addEventListener("click", () => {
    window.location.href = "reservation.html";
  });
});

document.querySelectorAll("[data-open-story]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("#story")?.scrollIntoView({ behavior: "smooth" });
  });
});

document.addEventListener("click", (event) => {
  const filterButton = event.target.closest("[data-filter]");
  if (!filterButton) return;
  const category = filterButton.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.classList.toggle("active", button === filterButton);
  });
  document.querySelectorAll("[data-menu-card]").forEach((card) => {
    card.hidden = category !== "all" && card.dataset.category !== category;
  });
});

const followLinks = document.querySelector(".follow-links");
if (followLinks) {
  const links = [
    ["https://www.facebook.com/ABCTEastridge", "Facebook", "ABCT Eastridge · News and updates", true],
    ["https://www.instagram.com/abct_eastridge", "Instagram", "@abct_eastridge · Behind the scenes", true],
    ["https://www.tiktok.com/@abcteastridge", "TikTok", "@abcteastridge · New dishes and updates", true],
    ["mailto:abcteastridge@gmail.com", "abcteastridge@gmail.com", "Reservations, events, and questions", false],
    ["tel:+639544000221", "09544000221", "Call ABCT directly", false],
  ];
  followLinks.innerHTML = links.map(([href, label, detail, external], index) => `
    <a class="social-link" href="${href}"${external ? ' target="_blank" rel="noreferrer"' : ""} data-social="${label}">
      <span class="social-index">${String(index + 1).padStart(2, "0")}</span>
      <span><strong>${label}</strong><small>${detail}</small></span>
    </a>`).join("");
}

window.ABCTShowToast = showToast;
