const PHILIPPINE_MOBILE_PATTERN = /^\+639\d{9}$/;

function normalizePhilippineMobile(value) {
  if (typeof value !== "string") return null;

  const compact = value.trim().replace(/[\s().-]/g, "");
  if (/^09\d{9}$/.test(compact)) {
    return `+63${compact.slice(1)}`;
  }
  if (PHILIPPINE_MOBILE_PATTERN.test(compact)) {
    return compact;
  }
  return null;
}

function isPhilippineMobile(value) {
  return typeof value === "string" && (PHILIPPINE_MOBILE_PATTERN.test(value) || /^09\d{9}$/.test(value));
}

export { isPhilippineMobile, normalizePhilippineMobile, PHILIPPINE_MOBILE_PATTERN };
