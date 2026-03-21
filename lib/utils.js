export function parseNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return null;
  if (typeof value === "object") {
    if (value.amount != null) return parseNumber(value.amount);
    if (value.value != null) return parseNumber(value.value);
    return null;
  }
  const s = String(value).trim();
  if (!s) return null;
  const cleaned = s.replace(/[$,\s]/g, "").replace(/%/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function normalizeZillowUrl(href) {
  if (href == null || href === "") return null;
  const s = String(href).trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return `https://www.zillow.com${s}`;
  return `https://www.zillow.com/${s.replace(/^\//, "")}`;
}

export function extractZpidFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/(\d{6,})_zpid/i) ?? String(url).match(/\/(\d{6,})(?:\/?|$)/);
  return m ? m[1] : null;
}

export function statusLabel(homeStatus) {
  if (homeStatus == null || homeStatus === "") return null;
  return String(homeStatus).replace(/_/g, " ");
}

export function assertZillowUrl(url, fieldName) {
  if (!url || typeof url !== "string") {
    return `${fieldName} is required`;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return `${fieldName} must be a valid URL`;
  }
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith("zillow.com")) {
    return `${fieldName} must be a zillow.com URL`;
  }
  return null;
}
