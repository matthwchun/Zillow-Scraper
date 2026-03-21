import { chromium } from "playwright";
import {
  NAV_TIMEOUT_MS,
  PAYMENT_DOM_WAIT_MS,
  HEADFUL,
  PLAYWRIGHT_CHANNEL,
  ZILLOW_WARMUP,
  CHROMIUM_ARGS,
  BROWSER_EXTRA_HEADERS,
  PLAYWRIGHT_PROXY,
} from "./config.js";

let browserPromise = null;

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
    out.principal_and_interest = firstMoneyAfter(
      /principal\s*(?:&|and)\s*interest/i,
    );
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

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    await b?.close().catch(() => {});
    browserPromise = null;
  }
}

async function withPage(fn) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: BROWSER_EXTRA_HEADERS,
    javaScriptEnabled: true,
    ...(PLAYWRIGHT_PROXY ? { proxy: PLAYWRIGHT_PROXY } : {}),
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

export async function fetchNextData(url, options = {}) {
  const scrapeDomPayment = Boolean(options.scrapeDomPayment);
  return withPage(async (page) => {
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      /* validated upstream */
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
