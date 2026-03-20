/**
 * One-off: print __NEXT_DATA__.props.pageProps shape for a Zillow homedetails URL.
 * Usage: node scripts/peek-pageprops.mjs "https://www.zillow.com/homedetails/..."
 */
import "dotenv/config";
import { chromium } from "playwright";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/peek-pageprops.mjs <listingUrl>");
  process.exit(1);
}

const args = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--window-size=1920,1080",
  "--disable-blink-features=AutomationControlled",
];
const channel = process.env.PLAYWRIGHT_CHANNEL?.trim();
const headful = process.env.HEADFUL === "1";

function findZpidObjects(obj, path = "", depth = 0, out = []) {
  if (!obj || typeof obj !== "object" || depth > 12) return out;
  if (obj.zpid === 7172527 || String(obj.zpid) === "7172527") {
    out.push({ path, keys: Object.keys(obj).slice(0, 40) });
  }
  if (depth > 8) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") findZpidObjects(v, `${path}.${k}`, depth + 1, out);
  }
  return out;
}

const browser = await chromium.launch({
  headless: !headful,
  ...(channel ? { channel } : {}),
  args,
  ignoreDefaultArgs: ["--enable-automation"],
});

const context = await browser.newContext({
  locale: "en-US",
  viewport: { width: 1920, height: 1080 },
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});
const page = await context.newPage();
await page.goto("https://www.zillow.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
await new Promise((r) => setTimeout(r, 800));
const res = await page.goto(url, { waitUntil: "domcontentloaded" });
console.log("HTTP", res?.status());

const nextData = await page.evaluate(() => {
  const el = document.getElementById("__NEXT_DATA__");
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
});

const cacheMeta = await page.evaluate(() => {
  const el = document.getElementById("__NEXT_DATA__");
  const d = el?.textContent ? JSON.parse(el.textContent) : null;
  const raw = d?.props?.pageProps?.componentProps?.gdpClientCache;
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const firstKey =
    parsed && typeof parsed === "object" ? Object.keys(parsed)[0] : null;
  const firstVal = firstKey ? parsed[firstKey] : null;
  return {
    rawType: typeof raw,
    parsedKeyCount:
      parsed && typeof parsed === "object" ? Object.keys(parsed).length : null,
    firstKeySnippet: firstKey?.slice(0, 80),
    firstValKeys:
      firstVal && typeof firstVal === "object"
        ? Object.keys(firstVal).slice(0, 20)
        : null,
    propertyZpid: firstVal?.property?.zpid,
  };
});

await browser.close();
console.log("gdpClientCache meta (in-page):", cacheMeta);

if (!nextData?.props?.pageProps) {
  console.log("No pageProps", nextData ? Object.keys(nextData) : null);
  process.exit(1);
}

const pp = nextData.props.pageProps;
console.log("pageProps keys:", Object.keys(pp));

for (const k of Object.keys(pp)) {
  const v = pp[k];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const sub = Object.keys(v).slice(0, 15);
    if (k.toLowerCase().includes("cache") || k.toLowerCase().includes("gdp")) {
      console.log(`  ${k} subkeys (first 15):`, sub);
    }
  }
}

const hits = findZpidObjects(pp, "pageProps", 0, []);
console.log("Objects with zpid 7172527:", hits.length);
for (const h of hits.slice(0, 5)) {
  console.log("  path:", h.path);
  console.log("  sample keys:", h.keys);
}

const cache = pp.componentProps?.gdpClientCache;
if (cache && typeof cache === "object") {
  const keys = Object.keys(cache);
  console.log("\ngdpClientCache keys count:", keys.length);
  for (const k of keys.slice(0, 6)) {
    const e = cache[k];
    console.log("--- cache key:", k);
    console.log(
      "  entry keys:",
      e && typeof e === "object" ? Object.keys(e).slice(0, 25) : typeof e,
    );
    if (e?.property) console.log("  property.zpid:", e.property.zpid);
  }
}
