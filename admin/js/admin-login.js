// Keep this aligned with the backend PORT in the root .env file.
// A deployed build can override it before this script loads with:
// window.ABCT_API_BASE_URL = "https://api.example.com";
const API_BASE_URL = window.ABCT_API_BASE_URL || "http://127.0.0.1:3101";
const SESSION_KEY = "abct_admin_session";
const form = document.querySelector("#login-form");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const emailError = document.querySelector("#email-error");
const passwordError = document.querySelector("#password-error");
const summary = document.querySelector("#login-summary");
const status = document.querySelector("#login-status");
const submitButton = document.querySelector("#login-submit");

const setFieldError = (element, message) => {
  element.textContent = message;
  element.hidden = !message;
};

const setSummary = (message) => {
  summary.textContent = message;
  summary.hidden = !message;
};

function validateForm() {
  setFieldError(emailError, "");
  setFieldError(passwordError, "");
  setSummary("");

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  let valid = true;

  if (!email) {
    setFieldError(emailError, "Enter your work email.");
    valid = false;
  } else if (!emailInput.validity.valid) {
    setFieldError(emailError, "Enter a valid email address.");
    valid = false;
  }

  if (!password) {
    setFieldError(passwordError, "Enter your password.");
    valid = false;
  }

  return valid;
}

function loginError(response, body) {
  if (response.status === 429) return "Too many attempts. Please wait and try again.";
  if (response.status === 401) return "Invalid email or password.";
  return body?.message || "We could not sign you in. Please try again.";
}

const loginHint = document.querySelector(".login-hint");
if (loginHint) {
  loginHint.textContent = "Use your ABCT staff account. Your session stays in this browser tab only.";
}

if (sessionStorage.getItem(SESSION_KEY)) {
  window.location.replace("dashboard.html");
}

document.querySelector("#toggle-password")?.addEventListener("click", (event) => {
  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  event.currentTarget.textContent = showing ? "Show" : "Hide";
  event.currentTarget.setAttribute("aria-label", showing ? "Show password" : "Hide password");
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validateForm()) {
    status.textContent = "Please correct the highlighted fields.";
    return;
  }

  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  status.textContent = "Signing in…";

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userEmail: emailInput.value.trim(),
        password: passwordInput.value,
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body.token) {
      setSummary(loginError(response, body));
      status.textContent = "Sign-in was not completed.";
      return;
    }

    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: body.token, user: body.user }));
    status.textContent = "Signed in. Opening the dashboard…";
    window.location.replace("dashboard.html");
  } catch {
    setSummary("The service is unavailable. Check your connection and try again.");
    status.textContent = "Sign-in was not completed.";
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
  }
});
