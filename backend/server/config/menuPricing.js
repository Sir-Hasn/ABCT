const MEAL_UPGRADE_FEE = 420;

// Zen Teishoku is available for these menu sections. Matching is normalized
// so the API accepts the display casing used by staff while keeping the rule
// in one place for every booking calculation.
const MEAL_UPGRADE_CATEGORIES = new Set([
  "tempura \u5929\u3077\u3089",
  "agemono \u63da\u3052\u7269",
  "yakimono \u713c\u304d\u7269",
  "teppanyaki \u9244\u677f\u713c\u304d",
]);

function normalizeMenuCategory(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isMealUpgradeEligible(itemOrCategory) {
  const category = typeof itemOrCategory === "string"
    ? itemOrCategory
    : itemOrCategory?.itemCategory;
  return MEAL_UPGRADE_CATEGORIES.has(normalizeMenuCategory(category));
}

export { MEAL_UPGRADE_FEE, MEAL_UPGRADE_CATEGORIES, normalizeMenuCategory, isMealUpgradeEligible };
