//Shared behavior across pages — navigation menu toggling, any common UI logic
const menuToggle = document.querySelector('#menu-toggle');
const mainNav = document.querySelector('#main-nav');
// The toast is a temporary, non-blocking status message for UI-only actions such as previews and form confirmations.
const toast = document.querySelector('#toast');
const backdrop = document.querySelector('#modal-backdrop');
const modalClose = document.querySelector('#modal-close');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

menuToggle.addEventListener('click', () => {
  const isOpen = mainNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
});

document.querySelectorAll('.main-nav a').forEach((link) => {
  link.addEventListener('click', () => {
    mainNav.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  });
});

document.querySelectorAll('[data-filter]').forEach((filterButton) => {
  filterButton.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach((button) => button.classList.remove('active'));
    filterButton.classList.add('active');
    const category = filterButton.dataset.filter;
    document.querySelectorAll('.dish-card').forEach((card) => {
      card.hidden = category !== 'all' && card.dataset.category !== category;
    });
  });
});

function openModal() {
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  modalClose.focus();
}
function closeModal() {
  backdrop.hidden = true;
  document.body.style.overflow = '';
}

document.querySelectorAll('[data-open-reservation]').forEach((button) => button.addEventListener('click', openModal));
document.querySelector('[data-open-menu]').addEventListener('click', () => showToast('The full menu is coming soon — enjoy this preview for now.'));
document.querySelector('[data-open-story]').addEventListener('click', () => showToast('Our story begins with one small counter in Tokyo.'));
modalClose.addEventListener('click', closeModal);
backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !backdrop.hidden) closeModal(); });

document.querySelector('#reservation-form').addEventListener('submit', (event) => {
  event.preventDefault();
  closeModal();
  showToast('Thanks — your table request is ready to be connected.');
  event.target.reset();
});

document.querySelector('#newsletter-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const email = document.querySelector('#email');
  if (!email.value) return;
  showToast('You’re on the list. See you at ABCT.');
  event.target.reset();
});
