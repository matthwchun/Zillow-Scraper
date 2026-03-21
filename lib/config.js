export const NAV_TIMEOUT_MS = 60_000;

/** Uniform ± ms applied to search settle + payment DOM waits (0 = off). */
export const DOM_TIMING_JITTER_MS = Number.parseInt(
  process.env.DOM_TIMING_JITTER_MS ?? "800",
  10,
);

/**
 * @param {number} baseMs
 * @param {number} jitterMaxMs
 */
export function applyTimingJitter(baseMs, jitterMaxMs) {
  const b = Math.max(0, Math.round(Number(baseMs) || 0));
  const j = Math.max(0, Math.round(Number(jitterMaxMs) || 0));
  if (j === 0) return b;
  const delta = Math.floor(Math.random() * (2 * j + 1)) - j;
  return Math.max(0, b + delta);
}

/** Uniform random ms for payment DOM scroll budget (replaces base+jitter for that total). */
export const PAYMENT_DOM_WAIT_RANDOM_RANGE =
  process.env.PAYMENT_DOM_WAIT_RANDOM_RANGE === "1" ||
  process.env.PAYMENT_DOM_WAIT_RANDOM_RANGE === "true" ||
  process.env.PAYMENT_DOM_WAIT_RANDOM_RANGE === "yes";

export const PAYMENT_DOM_WAIT_MS_MIN = Number.parseInt(
  process.env.PAYMENT_DOM_WAIT_MS_MIN ?? "4000",
  10,
);
export const PAYMENT_DOM_WAIT_MS_MAX = Number.parseInt(
  process.env.PAYMENT_DOM_WAIT_MS_MAX ?? "7500",
  10,
);

/** Total ms split pre/post scroll for payment DOM; random in [min,max] or jittered base. */
export function resolvePaymentDomWaitTotalMs() {
  if (PAYMENT_DOM_WAIT_RANDOM_RANGE) {
    const lo = Math.min(PAYMENT_DOM_WAIT_MS_MIN, PAYMENT_DOM_WAIT_MS_MAX);
    const hi = Math.max(PAYMENT_DOM_WAIT_MS_MIN, PAYMENT_DOM_WAIT_MS_MAX);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  return applyTimingJitter(PAYMENT_DOM_WAIT_MS, DOM_TIMING_JITTER_MS);
}

export const PAYMENT_DOM_WAIT_MS = Number.parseInt(
  process.env.PAYMENT_DOM_WAIT_MS ?? "5500",
  10,
);
/** Extra ms after scroll before reading payment DOM (calculator hydration). */
export const PAYMENT_DOM_SETTLE_MS = Number.parseInt(
  process.env.PAYMENT_DOM_SETTLE_MS ?? "800",
  10,
);
/** After __NEXT_DATA__ exists on search (no payment DOM scrape); 0 = old behavior. */
export const SEARCH_SETTLE_MS = Number.parseInt(
  process.env.SEARCH_SETTLE_MS ?? "1500",
  10,
);
export const PAYMENT_DEBUG =
  process.env.PAYMENT_DEBUG === "1" ||
  process.env.PAYMENT_DEBUG === "true" ||
  process.env.PAYMENT_DEBUG === "yes";
export const PLAYWRIGHT_CHANNEL =
  process.env.PLAYWRIGHT_CHANNEL?.trim() || undefined;

/**
 * Chromium UI/CSS scale (1 = normal). On Windows with display scaling, forcing 1 via
 * --force-device-scale-factor often makes the headful window look less “zoomed” without changing OS settings.
 */
function parseBrowserDeviceScaleFactor() {
  const raw = process.env.BROWSER_DEVICE_SCALE_FACTOR?.trim();
  if (raw === undefined || raw === "") return 1;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0.25 || n > 4) return 1;
  return n;
}

export const BROWSER_DEVICE_SCALE_FACTOR = parseBrowserDeviceScaleFactor();
export const HEADFUL =
  process.env.HEADFUL === "1" ||
  process.env.HEADFUL === "true" ||
  process.env.HEADFUL === "yes";
export const ZILLOW_WARMUP =
  process.env.ZILLOW_WARMUP !== "0" && process.env.ZILLOW_WARMUP !== "false";

/** Extra ms after zillow.com warm-up navigation (cookies / first-party context). */
export const ZILLOW_WARMUP_MS = Number.parseInt(
  process.env.ZILLOW_WARMUP_MS ?? "1500",
  10,
);

/** Mouse moves + gradual scroll on Zillow loads (0/false = off). */
export const ZILLOW_HUMANIZE =
  process.env.ZILLOW_HUMANIZE !== "0" && process.env.ZILLOW_HUMANIZE !== "false";

/** Extra random pause after humanize moves (ms). */
export const ZILLOW_HUMANIZE_MS_MIN = Number.parseInt(
  process.env.ZILLOW_HUMANIZE_MS_MIN ?? "200",
  10,
);
export const ZILLOW_HUMANIZE_MS_MAX = Number.parseInt(
  process.env.ZILLOW_HUMANIZE_MS_MAX ?? "600",
  10,
);

/**
 * After navigation, try to find a “press and hold” challenge control and keep left mouse down
 * until the page is torn down (released in fetchNextData finally). Fragile; default off.
 */
export const ZILLOW_CHALLENGE_HOLD =
  process.env.ZILLOW_CHALLENGE_HOLD === "1" ||
  process.env.ZILLOW_CHALLENGE_HOLD === "true" ||
  process.env.ZILLOW_CHALLENGE_HOLD === "yes";

/** Ms to wait after humanize before searching for the hold widget (challenge may hydrate late). */
export const ZILLOW_CHALLENGE_HOLD_WAIT_MS = Number.parseInt(
  process.env.ZILLOW_CHALLENGE_HOLD_WAIT_MS ?? "800",
  10,
);

/**
 * Listing details: read payment breakdown from the live DOM (scroll + evaluate).
 * Set 0 to use only embedded JSON for payment fields (less page interaction, may miss DOM-only values).
 */
export const PAYMENT_DOM_SCRAPE =
  process.env.PAYMENT_DOM_SCRAPE !== "0" &&
  process.env.PAYMENT_DOM_SCRAPE !== "false";

/** Delay between CLI scrape retries (run-search.js / run-detail.js). */
export const CLI_RETRY_DELAY_MS = Number.parseInt(
  process.env.CLI_RETRY_DELAY_MS ?? "2500",
  10,
);

/** Extra pause before a retry when the failure looks like HTTP 403/429 (uniform random in range). */
export const CLI_RETRY_DELAY_403_MS_MIN = Number.parseInt(
  process.env.CLI_RETRY_DELAY_403_MS_MIN ?? "3000",
  10,
);
export const CLI_RETRY_DELAY_403_MS_MAX = Number.parseInt(
  process.env.CLI_RETRY_DELAY_403_MS_MAX ?? "5000",
  10,
);

/** True when the error looks like HTTP 403/429 (blocked / rate-limited). */
export function isBlockedStyleError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /\b403\b/.test(msg) ||
    /HTTP\s*403/i.test(msg) ||
    /\b429\b/.test(msg) ||
    /HTTP\s*429/i.test(msg)
  );
}

/** Pick delay before next CLI/API attempt: longer random band after block-like errors, else default. */
export function resolveCliRetryDelayAfterError(err) {
  if (isBlockedStyleError(err)) {
    const lo = Math.min(CLI_RETRY_DELAY_403_MS_MIN, CLI_RETRY_DELAY_403_MS_MAX);
    const hi = Math.max(CLI_RETRY_DELAY_403_MS_MIN, CLI_RETRY_DELAY_403_MS_MAX);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  return CLI_RETRY_DELAY_MS;
}

function getPlaywrightProxy() {
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
