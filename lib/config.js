export const NAV_TIMEOUT_MS = 60_000;
export const PAYMENT_DOM_WAIT_MS = Number.parseInt(
  process.env.PAYMENT_DOM_WAIT_MS ?? "3500",
  10,
);
export const PLAYWRIGHT_CHANNEL =
  process.env.PLAYWRIGHT_CHANNEL?.trim() || undefined;
export const HEADFUL =
  process.env.HEADFUL === "1" ||
  process.env.HEADFUL === "true" ||
  process.env.HEADFUL === "yes";
export const ZILLOW_WARMUP =
  process.env.ZILLOW_WARMUP !== "0" && process.env.ZILLOW_WARMUP !== "false";

export function getPlaywrightProxy() {
  let raw = process.env.PROXY_SERVER?.trim();
  if (!raw) return undefined;
  if (!/^[a-z][\w+.-]*:\/\//i.test(raw)) raw = `http://${raw}`;
  try {
    const u = new URL(raw);
    if (!u.hostname) return undefined;
    let server;
    if (u.port) {
      server = `${u.protocol}//${u.hostname}:${u.port}`;
    } else if (u.protocol === "http:") {
      server = `http://${u.hostname}:80`;
    } else if (u.protocol === "https:") {
      server = `https://${u.hostname}:443`;
    } else {
      server = `${u.protocol}//${u.hostname}`;
    }
    const userFromUrl = u.username ? decodeURIComponent(u.username) : "";
    const passFromUrl = u.password ? decodeURIComponent(u.password) : "";
    const username =
      process.env.PROXY_USERNAME?.trim() || userFromUrl || undefined;
    const password =
      process.env.PROXY_PASSWORD?.trim() || passFromUrl || undefined;
    const proxy = { server };
    if (username) proxy.username = username;
    if (password) proxy.password = password;
    return proxy;
  } catch {
    console.warn("Invalid PROXY_SERVER; proxy disabled.");
    return undefined;
  }
}

export const PLAYWRIGHT_PROXY = getPlaywrightProxy();

export const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu",
  "--window-size=1920,1080",
  "--disable-blink-features=AutomationControlled",
];

export const BROWSER_EXTRA_HEADERS = {
  "Accept-Language": "en-US,en;q=0.9",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Upgrade-Insecure-Requests": "1",
};
