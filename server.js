import "dotenv/config";
import express from "express";
import { chromium } from "playwright";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const API_KEY = process.env.API_KEY ?? "";
const NAV_TIMEOUT_MS = 60_000;
const PAYMENT_DOM_WAIT_MS = Number.parseInt(process.env.PAYMENT_DOM_WAIT_MS ?? "3500", 10);
/** Set to `chrome` or `msedge` (Windows) so Playwright uses your installed browser—often fewer 403s than bundled Chromium. */
const PLAYWRIGHT_CHANNEL = process.env.PLAYWRIGHT_CHANNEL?.trim() || undefined;
/** Local only: `HEADFUL=1` opens a visible window; sometimes passes checks headless fails. */
const HEADFUL =
  process.env.HEADFUL === "1" ||
  process.env.HEADFUL === "true" ||
  process.env.HEADFUL === "yes";
/** Visit zillow.com first to pick up cookies (disable with `ZILLOW_WARMUP=0`). */
const ZILLOW_WARMUP = process.env.ZILLOW_WARMUP !== "0" && process.env.ZILLOW_WARMUP !== "false";

const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu",
  "--window-size=1920,1080",
  "--disable-blink-features=AutomationControlled",
];

const BROWSER_EXTRA_HEADERS = {
  "Accept-Language": "en-US,en;q=0.9",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Upgrade-Insecure-Requests": "1",
};

let browserPromise = null;

function jsonError(res, status, message, code = "error") {
  return res.status(status).json({ error: message, code });
}

function requireApiKey(req, res, next) {
  if (!API_KEY) {
    return jsonError(res, 503, "API_KEY is not configured", "misconfigured");
  }
  const auth = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  const token = match?.[1]?.trim();
  if (!token || token !== API_KEY) {
    return jsonError(res, 401, "Unauthorized", "unauthorized");
  }
  return next();
}

function parseNumber(value) {
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

function normalizeZillowUrl(href) {
  if (href == null || href === "") return null;
  const s = String(href).trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return `https://www.zillow.com${s}`;
  return `https://www.zillow.com/${s.replace(/^\//, "")}`;
}

function extractZpidFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/(\d{6,})_zpid/i) ?? String(url).match(/\/(\d{6,})(?:\/?|$)/);
  return m ? m[1] : null;
}

function statusLabel(homeStatus) {
  if (homeStatus == null || homeStatus === "") return null;
  return String(homeStatus).replace(/_/g, " ");
}

function mergeHomeFragments(...parts) {
  const out = {};
  for (const p of parts) {
    if (p && typeof p === "object") Object.assign(out, p);
  }
  return out;
}

function listingUrlFromParts(zpid, hi, fallbackPath) {
  const direct =
    hi?.hdpUrl ??
    hi?.pdpUrl ??
    hi?.listingUrl ??
    hi?.url ??
    fallbackPath;
  if (direct) return normalizeZillowUrl(direct);
  if (zpid) return normalizeZillowUrl(`/homedetails/${zpid}_zpid/`);
  return null;
}

function mapMergedToSearchListing(zpid, merged, latLong, rawItem) {
  const z = zpid != null ? String(zpid) : null;
  if (!z) return null;

  const lat =
    parseNumber(merged.latitude) ??
    parseNumber(merged.lat) ??
    parseNumber(latLong?.latitude) ??
    parseNumber(rawItem?.latLong?.latitude);
  const lng =
    parseNumber(merged.longitude) ??
    parseNumber(merged.lng) ??
    parseNumber(merged.lon) ??
    parseNumber(latLong?.longitude) ??
    parseNumber(rawItem?.latLong?.longitude);

  const address =
    merged.streetAddress ??
    merged.address ??
    merged.street ??
    null;
  const city = merged.city ?? merged.addressCity ?? null;
  const state = merged.state ?? merged.addressState ?? null;
  const zip = merged.zipcode ?? merged.addressZipcode ?? merged.postalCode ?? null;

  const price =
    parseNumber(merged.price) ??
    parseNumber(merged.unformattedPrice) ??
    parseNumber(merged.amount) ??
    null;
  const beds =
    parseNumber(merged.bedrooms) ?? parseNumber(merged.beds) ?? parseNumber(merged.bed) ?? null;
  const baths =
    parseNumber(merged.bathrooms) ?? parseNumber(merged.baths) ?? parseNumber(merged.bath) ?? null;
  const sqft =
    parseNumber(merged.livingArea) ??
    parseNumber(merged.area) ??
    parseNumber(merged.sqft) ??
    parseNumber(merged.livingAreaValue) ??
    null;

  const detailPath =
    rawItem?.detailUrl ??
    rawItem?.hdpUrl ??
    merged.detailUrl ??
    merged.hdpUrl ??
    null;

  return {
    listing_id: z,
    address,
    city,
    state,
    zip,
    price,
    beds,
    baths,
    sqft,
    lat,
    lng,
    listing_url: listingUrlFromParts(z, merged, detailPath),
    status: statusLabel(merged.homeStatus ?? merged.status ?? rawItem?.statusText),
  };
}

function collectSearchResultsArrays(searchPageState) {
  const arrays = [];
  if (!searchPageState || typeof searchPageState !== "object") return arrays;

  const catKeys = ["cat1", "cat2", "cat3"];
  for (const ck of catKeys) {
    const cat = searchPageState[ck];
    const sr = cat?.searchResults;
    if (!sr) continue;
    if (Array.isArray(sr.mapResults)) arrays.push(sr.mapResults);
    if (Array.isArray(sr.listResults)) arrays.push(sr.listResults);
  }

  const legacy = searchPageState.searchResults;
  if (legacy && typeof legacy === "object") {
    if (Array.isArray(legacy.mapResults)) arrays.push(legacy.mapResults);
    if (Array.isArray(legacy.listResults)) arrays.push(legacy.listResults);
  }

  return arrays;
}

function extractSearchListings(nextData) {
  const listings = [];
  const seen = new Set();

  const pageProps = nextData?.props?.pageProps;
  if (!pageProps) return listings;

  const stateCandidates = [
    pageProps.searchPageState,
    pageProps.initialSearchPageState,
    pageProps.searchPageStateFromClient,
  ].filter(Boolean);

  for (const sps of stateCandidates) {
    const groups = collectSearchResultsArrays(sps);
    for (const arr of groups) {
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const zpid = item.zpid ?? item.hdpData?.homeInfo?.zpid;
        const hi = item.hdpData?.homeInfo;
        const mini = item.miniCardData;
        const merged = mergeHomeFragments(hi, mini, item);
        const row = mapMergedToSearchListing(zpid, merged, item.latLong ?? merged, item);
        if (row && !seen.has(row.listing_id)) {
          seen.add(row.listing_id);
          listings.push(row);
        }
      }
    }
  }

  return listings;
}

function deepFindGdpClientCache(obj, depth = 0, maxDepth = 8) {
  if (!obj || typeof obj !== "object" || depth > maxDepth) return null;
  if (obj.gdpClientCache && typeof obj.gdpClientCache === "object") return obj.gdpClientCache;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const hit = deepFindGdpClientCache(v, depth + 1, maxDepth);
      if (hit) return hit;
    }
  }
  return null;
}

function pickPropertyFromCacheEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  return entry.property ?? entry.listing ?? entry.home ?? entry;
}

/** Zillow often embeds `gdpClientCache` as a JSON string inside `__NEXT_DATA__`. */
function parseGdpClientCache(maybe) {
  if (maybe == null) return null;
  if (typeof maybe === "object" && !Array.isArray(maybe)) return maybe;
  if (typeof maybe === "string") {
    try {
      const parsed = JSON.parse(maybe);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function findGdpCacheRow(cache, zpidWanted) {
  if (!cache || typeof cache !== "object") return { entry: null, property: null };
  const want = zpidWanted ? String(zpidWanted) : null;

  for (const val of Object.values(cache)) {
    const prop = pickPropertyFromCacheEntry(val);
    if (!prop || typeof prop !== "object") continue;
    const z = prop.zpid != null ? String(prop.zpid) : null;
    if (want && z === want) return { entry: val, property: prop };
  }

  if (want) {
    for (const val of Object.values(cache)) {
      const prop = pickPropertyFromCacheEntry(val);
      const z = prop?.zpid != null ? String(prop.zpid) : null;
      if (z === want) return { entry: val, property: prop };
    }
  }

  const first = Object.values(cache)[0];
  return {
    entry: first ?? null,
    property: pickPropertyFromCacheEntry(first),
  };
}

function addressBlock(prop) {
  const a = prop?.address;
  if (a && typeof a === "object") {
    return {
      address: a.streetAddress ?? a.street ?? null,
      city: a.city ?? null,
      state: a.state ?? null,
      zip: a.zipcode ?? a.zip ?? a.postalCode ?? null,
    };
  }
  return {
    address: prop?.streetAddress ?? null,
    city: prop?.city ?? null,
    state: prop?.state ?? null,
    zip: prop?.zipcode ?? prop?.postalCode ?? null,
  };
}

function pickRentEstimate(prop) {
  const r = prop?.rentZestimate ?? prop?.rentZestimateSection;
  if (r == null) return null;
  return parseNumber(r);
}

function pickZestimate(prop) {
  const z = prop?.zestimate ?? prop?.zestimateSection;
  return parseNumber(z);
}

function getOwnNumberCI(obj, ...names) {
  if (!obj || typeof obj !== "object") return null;
  const byLower = new Map();
  for (const k of Object.keys(obj)) {
    byLower.set(k.toLowerCase(), k);
  }
  for (const name of names) {
    const orig = byLower.get(name.toLowerCase());
    if (orig != null) {
      const n = parseNumber(obj[orig]);
      if (n != null) return n;
    }
  }
  return null;
}

function mergePaymentBreakdownNode(target, node) {
  if (!node || typeof node !== "object") return;
  target.principal_and_interest ??= getOwnNumberCI(
    node,
    "principalAndInterest",
    "principalInterest",
    "monthlyPrincipalAndInterest",
    "principalAndInterestPayment",
    "principalAndInt",
    "estimatedMonthlyPaymentPrincipalAndInterest",
    "monthlyPI",
    "piPayment",
  );
  target.mortgage_insurance ??= getOwnNumberCI(
    node,
    "mortgageInsurance",
    "monthlyMortgageInsurance",
    "privateMortgageInsurance",
    "pmi",
    "monthlyPMI",
  );
  target.property_taxes_monthly ??= getOwnNumberCI(
    node,
    "propertyTax",
    "propertyTaxes",
    "monthlyPropertyTax",
    "propertyTaxMonthly",
    "monthlyPropertyTaxes",
    "estimatedMonthlyPropertyTax",
    "monthlyTaxes",
  );
  target.home_insurance_monthly ??= getOwnNumberCI(
    node,
    "homeInsurance",
    "homeownersInsurance",
    "monthlyHomeInsurance",
    "hazardInsurance",
    "homeInsurancePremium",
    "monthlyHomeownersInsurance",
    "estimatedMonthlyHomeInsurance",
    "monthlyHomeownersInsurancePremium",
  );
  target.hoa_fees_monthly ??= getOwnNumberCI(
    node,
    "hoaFees",
    "hoaFee",
    "monthlyHoaFees",
    "monthlyHoaFee",
    "estimatedMonthlyHoaFees",
  );
  if (target.utilities == null) {
    const u = node.utilities ?? node.utilitiesNote ?? node.utilitiesDisclaimer;
    if (typeof u === "string" && u.trim()) {
      target.utilities = u.trim();
    } else if (typeof node.utilitiesIncluded === "boolean") {
      target.utilities = node.utilitiesIncluded ? "Included" : "Not included";
    }
  }
}

function paymentLineItemLabel(item) {
  if (!item || typeof item !== "object") return "";
  const parts = [
    item.type,
    item.componentType,
    item.name,
    item.title,
    item.displayName,
    item.label,
    item.key,
    item.category,
    item.description,
  ];
  return parts
    .filter((x) => x != null && String(x).trim() !== "")
    .join(" ")
    .toUpperCase();
}

function mergePaymentLineItemsFromArray(target, arr) {
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const label = paymentLineItemLabel(item);
    const amt =
      parseNumber(item.amount) ??
      parseNumber(item.monthlyAmount) ??
      parseNumber(item.value) ??
      parseNumber(item.estimatedMonthlyPayment) ??
      parseNumber(item.monthlyPayment);
    if (!label && amt == null) continue;
    if (
      /PRINCIPAL.*INTEREST|PRINCIPAL\s*&\s*INTEREST|P\s*&\s*I\b|MONTHLY.*PRINCIPAL|ESTIMATED.*P\s*&\s*I/i.test(
        label,
      ) ||
      (label.includes("PRINCIPAL") && label.includes("INTEREST"))
    ) {
      target.principal_and_interest ??= amt;
    } else if (/MORTGAGE.*INS|PMI|PRIVATE.*MORTGAGE|MIP\b/i.test(label)) {
      target.mortgage_insurance ??= amt;
    } else if (/PROPERTY.*TAX|ESTIMATED.*TAX|TAXES/i.test(label) && !/ANNUAL/i.test(label)) {
      target.property_taxes_monthly ??= amt;
    } else if (/HOME.*INS|HOMEOWNER|HAZARD.*INS/i.test(label)) {
      target.home_insurance_monthly ??= amt;
    } else if (/\bHOA\b|HOMEOWNER.*ASSOC/i.test(label)) {
      target.hoa_fees_monthly ??= amt;
    } else if (/UTILIT/i.test(label)) {
      if (target.utilities == null) {
        target.utilities =
          amt != null && amt > 0 ? String(amt) : "Not included";
      }
    }
  }
}

function deepScanLineItemArrays(target, obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 20) return;
  if (Array.isArray(obj)) {
    const looksLikeLineItems =
      obj.length > 0 &&
      obj.length <= 25 &&
      obj.every((x) => x && typeof x === "object") &&
      obj.some(
        (x) =>
          parseNumber(x.amount) != null ||
          parseNumber(x.monthlyAmount) != null ||
          paymentLineItemLabel(x).length > 2,
      );
    if (looksLikeLineItems) mergePaymentLineItemsFromArray(target, obj);
    for (const x of obj) deepScanLineItemArrays(target, x, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (
      /lineitem|paymentcomponent|monthlycomponent|housingcost|paymentbreakdown|monthlybreakdown|costbreakdown|estimatedpayment/i.test(
        k,
      ) &&
      Array.isArray(v)
    ) {
      mergePaymentLineItemsFromArray(target, v);
    }
    if (v && typeof v === "object") deepScanLineItemArrays(target, v, depth + 1);
  }
}

function extractPaymentBreakdown(prop, gdpEntry) {
  const out = {
    principal_and_interest: null,
    mortgage_insurance: null,
    property_taxes_monthly: null,
    home_insurance_monthly: null,
    hoa_fees_monthly: null,
    utilities: null,
  };

  const roots = [];
  if (prop) roots.push(prop);
  if (gdpEntry && typeof gdpEntry === "object") {
    roots.push(gdpEntry);
    if (gdpEntry.viewer) roots.push(gdpEntry.viewer);
  }

  const anchorKeys = [
    "mortgageEstimates",
    "mortgageZHL",
    "monthlyPaymentEstimate",
    "affordabilityEstimate",
    "estimatedMonthlyPayment",
    "monthlyPayment",
    "finance",
    "paymentBreakdown",
    "mortgageSection",
    "housingCost",
    "monthlyHousingPayment",
    "paymentCalculator",
    "mortgageCalculator",
    "affordabilityModule",
  ];

  for (const root of roots) {
    if (!root || typeof root !== "object") continue;
    deepScanLineItemArrays(out, root, 0);

    for (const ak of anchorKeys) {
      const sub = root[ak];
      if (!sub || typeof sub !== "object") continue;
      mergePaymentBreakdownNode(out, sub);
      mergePaymentBreakdownNode(out, sub.monthlyPaymentDetails);
      mergePaymentBreakdownNode(out, sub.paymentBreakdown);
      mergePaymentBreakdownNode(out, sub.breakdown);
      mergePaymentBreakdownNode(out, sub.details);
      mergePaymentBreakdownNode(out, sub.defaultScenario);
      mergePaymentBreakdownNode(out, sub.loanScenario);
      mergePaymentBreakdownNode(out, sub.monthlyCosts);
      mergePaymentBreakdownNode(out, sub.scenario);
      mergePaymentBreakdownNode(out, sub.estimate);
    }
  }

  const seen = new WeakSet();
  function walkPaymentNodes(o, depth) {
    if (!o || typeof o !== "object" || depth > 16) return;
    if (seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      for (const x of o) walkPaymentNodes(x, depth + 1);
      return;
    }
    const tn = o.__typename;
    if (typeof tn === "string" && /payment|mortgage|housing|afford|monthly|cost/i.test(tn)) {
      mergePaymentBreakdownNode(out, o);
      mergePaymentLineItemsFromArray(out, o.lineItems);
      mergePaymentLineItemsFromArray(out, o.components);
    }
    const keys = Object.keys(o);
    if (keys.length > 100) {
      for (const v of Object.values(o)) walkPaymentNodes(v, depth + 1);
      return;
    }
    const kl = keys.join(" ").toLowerCase();
    if (
      /principalandinterest|principalinterest|propertytax|homeinsurance|mortgageinsurance|hoafees?\b|monthlyhoa|housingpayment|monthlypayment|estimatedpayment|loanpayment/i.test(
        kl,
      )
    ) {
      mergePaymentBreakdownNode(out, o);
      mergePaymentLineItemsFromArray(out, o.lineItems);
      mergePaymentLineItemsFromArray(out, o.components);
    }
    for (const v of Object.values(o)) walkPaymentNodes(v, depth + 1);
  }

  for (const root of roots) walkPaymentNodes(root, 0);

  return out;
}

/** When JSON has no payment module, the visible “Payment breakdown” block is often hydrated in the DOM. */
function mergeDomPaymentBreakdown(out, dom) {
  if (!dom || typeof dom !== "object") return;
  for (const k of Object.keys(out)) {
    if (out[k] == null && dom[k] != null && dom[k] !== "") {
      out[k] = dom[k];
    }
  }
}

function scrapePaymentBreakdownDom(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? "";
    const out = {
      principal_and_interest: null,
      mortgage_insurance: null,
      property_taxes_monthly: null,
      home_insurance_monthly: null,
      hoa_fees_monthly: null,
      utilities: null,
    };
    function firstMoneyAfter(regex) {
      const i = text.search(regex);
      if (i < 0) return null;
      const chunk = text.slice(i, Math.min(i + 220, text.length));
      const m = chunk.match(/\$\s*([\d,]+)/);
      if (!m) return null;
      const n = Number.parseInt(m[1].replace(/,/g, ""), 10);
      return Number.isFinite(n) ? n : null;
    }
    out.principal_and_interest = firstMoneyAfter(/principal\s*(?:&|and)\s*interest/i);
    out.mortgage_insurance = firstMoneyAfter(/mortgage insurance/i);
    out.property_taxes_monthly = firstMoneyAfter(/property taxes/i);
    out.home_insurance_monthly = firstMoneyAfter(/home insurance/i);
    out.hoa_fees_monthly = firstMoneyAfter(/hoa fees?/i);
    const utilIdx = text.search(/utilities/i);
    if (utilIdx >= 0) {
      const uchunk = text.slice(utilIdx, utilIdx + 120);
      out.utilities = /not included/i.test(uchunk) ? "Not included" : null;
    }
    return out;
  });
}

function extractDetailListing(nextData, listingUrl, domPaymentHint = null) {
  const zpidWanted = extractZpidFromUrl(listingUrl);
  const pageProps = nextData?.props?.pageProps;
  if (!pageProps) return null;

  const rawCache =
    pageProps.gdpClientCache ??
    pageProps.componentProps?.gdpClientCache ??
    deepFindGdpClientCache(pageProps);
  const cache = parseGdpClientCache(rawCache);

  let gdpEntry = null;
  let prop = null;
  if (cache) {
    const row = findGdpCacheRow(cache, zpidWanted);
    gdpEntry = row.entry;
    prop = row.property;
  }

  if (!prop) {
    const alt = pageProps.property ?? pageProps.listing ?? pageProps.home;
    if (alt && typeof alt === "object") prop = alt;
  }

  if (!prop || typeof prop !== "object") return null;

  const addr = addressBlock(prop);
  const zpid = prop.zpid != null ? String(prop.zpid) : zpidWanted;

  const baths =
    parseNumber(prop.bathrooms) ??
    parseNumber(prop.bathroomCount) ??
    parseNumber(prop.resoFacts?.bathrooms) ??
    null;

  const lot =
    parseNumber(prop.lotAreaValue) ??
    parseNumber(prop.resoFacts?.lotSize) ??
    parseNumber(prop.lotSize) ??
    null;

  const hoa =
    parseNumber(prop.monthlyHoaFee) ??
    parseNumber(prop.hoaFee) ??
    parseNumber(prop.resoFacts?.hoaFee) ??
    null;

  const tax =
    parseNumber(prop.taxAnnualAmount) ??
    parseNumber(prop.taxHistory?.[0]?.taxPaid) ??
    null;

  const days =
    parseNumber(prop.daysOnZillow) ??
    parseNumber(prop.timeOnZillow?.days) ??
    parseNumber(prop.attributionInfo?.timeOnZillow) ??
    null;

  return {
    listing_id: zpid ?? null,
    address: addr.address,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
    price:
      parseNumber(prop.price) ??
      parseNumber(prop.unformattedPrice) ??
      parseNumber(prop.listingPrice) ??
      null,
    beds:
      parseNumber(prop.bedrooms) ??
      parseNumber(prop.bedroomCount) ??
      parseNumber(prop.resoFacts?.bedrooms) ??
      null,
    baths,
    sqft:
      parseNumber(prop.livingArea) ??
      parseNumber(prop.livingAreaValue) ??
      parseNumber(prop.area) ??
      parseNumber(prop.resoFacts?.livingArea) ??
      null,
    year_built:
      parseNumber(prop.yearBuilt) ?? parseNumber(prop.resoFacts?.yearBuilt) ?? null,
    property_type: prop.homeType ?? prop.propertyTypeDimension ?? prop.resoFacts?.homeType ?? null,
    status: statusLabel(prop.homeStatus ?? prop.listingStatus),
    zestimate: pickZestimate(prop),
    rent_estimate: pickRentEstimate(prop),
    hoa_monthly: hoa,
    tax_annual: tax,
    lot_size: lot,
    days_on_zillow: days,
    listing_url: normalizeZillowUrl(listingUrl),
    payment_breakdown: (() => {
      const pb = extractPaymentBreakdown(prop, gdpEntry);
      mergeDomPaymentBreakdown(pb, domPaymentHint);
      if (pb.hoa_fees_monthly == null) {
        const h =
          parseNumber(prop.monthlyHoaFee) ??
          parseNumber(prop.hoaFee) ??
          parseNumber(prop.resoFacts?.hoaFee);
        if (h != null) pb.hoa_fees_monthly = h;
      }
      return pb;
    })(),
  };
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: !HEADFUL,
      ...(PLAYWRIGHT_CHANNEL ? { channel: PLAYWRIGHT_CHANNEL } : {}),
      args: CHROMIUM_ARGS,
      ignoreDefaultArgs: ["--enable-automation"],
    });
  }
  return browserPromise;
}

async function withPage(fn) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: BROWSER_EXTRA_HEADERS,
    javaScriptEnabled: true,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  page.setDefaultTimeout(NAV_TIMEOUT_MS);
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function fetchNextData(url, options = {}) {
  const scrapeDomPayment = Boolean(options.scrapeDomPayment);
  return withPage(async (page) => {
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      /* assertZillowUrl already validated */
    }
    if (ZILLOW_WARMUP && host.endsWith("zillow.com")) {
      await page
        .goto("https://www.zillow.com/", { waitUntil: "domcontentloaded" })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
    }

    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!response) {
      throw new Error("No response from navigation");
    }
    if (response.status() >= 400) {
      throw new Error(`Page returned HTTP ${response.status()}`);
    }
    await page.waitForFunction(
      () => {
        const el = document.getElementById("__NEXT_DATA__");
        return el && el.textContent && el.textContent.length > 10;
      },
      { timeout: NAV_TIMEOUT_MS },
    );
    const raw = await page.evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__");
      if (!el?.textContent) return null;
      try {
        return JSON.parse(el.textContent);
      } catch {
        return null;
      }
    });
    if (!raw) {
      throw new Error("Could not parse __NEXT_DATA__");
    }

    let domPayment = null;
    if (scrapeDomPayment && /homedetails/i.test(url)) {
      const total = PAYMENT_DOM_WAIT_MS;
      const beforeScroll = Math.min(1500, total);
      const afterScroll = Math.max(0, total - beforeScroll);
      await new Promise((r) => setTimeout(r, beforeScroll));
      await page
        .evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, afterScroll));
      domPayment = await scrapePaymentBreakdownDom(page);
    }

    return { nextData: raw, domPayment };
  });
}

function assertZillowUrl(url, fieldName) {
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

const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "zillow-scraper-service" });
});

app.post("/search", requireApiKey, async (req, res) => {
  const { searchUrl } = req.body ?? {};
  const err = assertZillowUrl(searchUrl, "searchUrl");
  if (err) return jsonError(res, 400, err, "bad_request");

  try {
    const { nextData } = await fetchNextData(searchUrl);
    const listings = extractSearchListings(nextData);
    return res.json({ count: listings.length, listings });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Search scrape failed";
    return jsonError(res, 502, message, "scrape_failed");
  }
});

app.post("/details", requireApiKey, async (req, res) => {
  const { listingUrl } = req.body ?? {};
  const err = assertZillowUrl(listingUrl, "listingUrl");
  if (err) return jsonError(res, 400, err, "bad_request");

  try {
    const { nextData, domPayment } = await fetchNextData(listingUrl, {
      scrapeDomPayment: true,
    });
    const detail = extractDetailListing(nextData, listingUrl, domPayment);
    if (!detail || !detail.listing_id) {
      return jsonError(
        res,
        502,
        "Could not extract listing details from page JSON",
        "scrape_failed",
      );
    }
    return res.json(detail);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Details scrape failed";
    return jsonError(res, 502, message, "scrape_failed");
  }
});

app.use((_req, res) => jsonError(res, 404, "Not found", "not_found"));

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return jsonError(res, 400, "Invalid JSON body", "bad_request");
  }
  return next(err);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  return jsonError(res, 500, "Internal server error", "internal_error");
});

const server = app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
  if (!API_KEY) console.warn("Warning: API_KEY is not set; POST routes will return 503.");
  if (PLAYWRIGHT_CHANNEL) console.log(`Playwright channel: ${PLAYWRIGHT_CHANNEL}`);
  if (HEADFUL) console.log("Headful browser (HEADFUL=1)");
  if (!ZILLOW_WARMUP) console.log("Zillow homepage warm-up disabled (ZILLOW_WARMUP=0)");
});

async function shutdown() {
  console.log("Shutting down...");
  server.close();
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    await b?.close().catch(() => {});
    browserPromise = null;
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
