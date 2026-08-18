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

const newsletterForm = document.querySelector("#newsletter-form");
newsletterForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!newsletterForm.reportValidity()) return;
  showToast("You’re on the list. See you at ABCT.");
  newsletterForm.reset();
});

window.ABCTShowToast = showToast;
