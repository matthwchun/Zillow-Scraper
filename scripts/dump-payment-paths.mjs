/**
 * Find where monthly payment numbers live (run from repo root).
 * Usage: node scripts/dump-payment-paths.mjs [listingUrl]
 */
import "dotenv/config";
import { chromium } from "playwright";

const url =
  process.argv[2] ??
  "https://www.zillow.com/homedetails/9580-Redstar-St-Las-Vegas-NV-89123/7172527_zpid/";

const channel = process.env.PLAYWRIGHT_CHANNEL?.trim();
const browser = await chromium.launch({
  headless: true,
  ...(channel ? { channel } : {}),
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1920,1080",
  ],
  ignoreDefaultArgs: ["--enable-automation"],
});
const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});
const page = await ctx.newPage();
await page.goto("https://www.zillow.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
await new Promise((r) => setTimeout(r, 800));
const res = await page.goto(url, { waitUntil: "domcontentloaded" });
console.error("HTTP", res?.status());

const { entry, prop } = await page.evaluate(() => {
  const el = document.getElementById("__NEXT_DATA__");
  if (!el?.textContent) return {};
  const d = JSON.parse(el.textContent);
  const raw = d?.props?.pageProps?.componentProps?.gdpClientCache;
  let cache = raw;
  if (typeof raw === "string") cache = JSON.parse(raw);
  const first = cache && typeof cache === "object" ? Object.values(cache)[0] : null;
  return {
    entry: first,
    prop: first?.property,
  };
});

await browser.close();

function findNumbers(obj, targets, path = "", depth = 0, out = []) {
  if (!obj || depth > 18) return out;
  if (typeof obj === "number" && targets.includes(obj)) {
    out.push({ path, value: obj });
  }
  if (typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    obj.forEach((x, i) => findNumbers(x, targets, `${path}[${i}]`, depth + 1, out));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    findNumbers(v, targets, p, depth + 1, out);
  }
  return out;
}

const targets = [2338, 199, 163, 17, 2339, 2360];
console.log("=== entry top-level keys ===", entry ? Object.keys(entry) : null);
console.log("=== viewer keys (first 40) ===", entry?.viewer ? Object.keys(entry.viewer).slice(0, 40) : null);

if (entry) {
  console.log("\n=== paths to target integers (entry subtree) ===");
  console.log(findNumbers(entry, targets));
}

if (prop) {
  console.log("\n=== property keys matching payment-ish ===");
  console.log(
    Object.keys(prop).filter((k) =>
      /payment|mortgage|monthly|afford|finance|loan|tax|insurance|hoa|cost|zhl|estimate|breakdown/i.test(
        k,
      ),
    ),
  );
  console.log("\n=== paths to target integers (property only) ===");
  console.log(findNumbers(prop, targets));
}
