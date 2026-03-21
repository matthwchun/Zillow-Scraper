import { chromium } from "playwright";
import {
  NAV_TIMEOUT_MS,
  PAYMENT_DOM_SETTLE_MS,
  SEARCH_SETTLE_MS,
  DOM_TIMING_JITTER_MS,
  applyTimingJitter,
  resolvePaymentDomWaitTotalMs,
  PAYMENT_DOM_WAIT_RANDOM_RANGE,
  PAYMENT_DOM_WAIT_MS_MIN,
  PAYMENT_DOM_WAIT_MS_MAX,
  PAYMENT_DEBUG,
  HEADFUL,
  PLAYWRIGHT_CHANNEL,
  ZILLOW_WARMUP,
  ZILLOW_WARMUP_MS,
  ZILLOW_HUMANIZE,
  ZILLOW_HUMANIZE_MS_MIN,
  ZILLOW_HUMANIZE_MS_MAX,
  PAYMENT_DOM_SCRAPE,
  BROWSER_DEVICE_SCALE_FACTOR,
  ZILLOW_CHALLENGE_HOLD,
  ZILLOW_CHALLENGE_HOLD_WAIT_MS,
  CHROMIUM_ARGS,
  BROWSER_EXTRA_HEADERS,
  PLAYWRIGHT_PROXY,
} from "./config.js";
import {
  tryStartPressAndHold,
  releasePressAndHold,
} from "./challenge-hold.js";

let browserPromise = null;

async function scrapePaymentBreakdownDom(page, { debug = false } = {}) {
  const { payment, debugInfo } = await page.evaluate((debug) => {
    const rowSnippets = [];

    function emptyOut() {
      return {
        principal_and_interest: null,
        mortgage_insurance: null,
        property_taxes_monthly: null,
        home_insurance_monthly: null,
        hoa_fees_monthly: null,
        utilities: null,
      };
    }

    function dollarsInLine(line) {
      let s = line;
      const p = s.indexOf("(");
      if (p >= 0) s = s.slice(0, p);
      const md = s.search(/\s+[—–]\s+/);
      if (md >= 0) s = s.slice(0, md);
      const m = s.match(/\$\s*([\d,]+)/);
      if (!m) return null;
      const n = Number.parseInt(m[1].replace(/,/g, ""), 10);
      return Number.isFinite(n) ? n : null;
    }

    function moneyAfterLabelOnRow(block, absIndex) {
      const win = block.slice(absIndex, Math.min(absIndex + 160, block.length));
      const nl = win.search(/\n/);
      const line1 = nl >= 0 ? win.slice(0, nl) : win;
      const n1 = dollarsInLine(line1);
      if (n1 != null) return n1;
      if (nl < 0) return null;
      const rest = win.slice(nl + 1);
      const nl2 = rest.search(/\n/);
      const line2 = nl2 >= 0 ? rest.slice(0, nl2) : rest;
      return dollarsInLine(line2);
    }

    const STEPS = [
      [/principal\s*(?:&|and)\s*interest\b/i, "principal_and_interest"],
      [
        /mortgage insurance|private mortgage(?:\s+insurance)?/i,
        "mortgage_insurance",
      ],
      [/property taxes/i, "property_taxes_monthly"],
      [/home insurance/i, "home_insurance_monthly"],
      [/(?:^|[\s\n])hoa fees?\b|monthly\s*hoa\b/i, "hoa_fees_monthly"],
    ];

    function fillFromBandInto(o, block) {
      let cursor = 0;
      for (const [re, key] of STEPS) {
        if (o[key] != null) continue;
        const slice = block.slice(cursor);
        const rel = slice.search(re);
        if (rel < 0) continue;
        const abs = cursor + rel;
        const n = moneyAfterLabelOnRow(block, abs);
        if (n != null) o[key] = n;
        cursor = abs + 1;
      }
    }

    function fallfillInto(o, wholeText) {
      let cursor = 0;
      for (const [re, key] of STEPS) {
        if (o[key] != null) continue;
        const slice = wholeText.slice(cursor);
        const rel = slice.search(re);
        if (rel < 0) continue;
        const abs = cursor + rel;
        const n = moneyAfterLabelOnRow(wholeText, abs);
        if (n != null) o[key] = n;
        cursor = abs + 1;
      }
    }

    function utilitiesFromBand(o, band) {
      const utilIdx = band.search(/\butilities\b/i);
      if (utilIdx >= 0) {
        const uchunk = band.slice(utilIdx, Math.min(utilIdx + 120, band.length));
        if (/not included/i.test(uchunk)) o.utilities = "Not included";
      }
    }

    function findPaymentBreakdownRoot() {
      const headings = document.querySelectorAll("h1,h2,h3,h4,h5,h6");
      for (const h of headings) {
        const t = (h.textContent || "").trim();
        if (!/payment breakdown/i.test(t)) continue;
        let cur = h.parentElement;
        for (let d = 0; d < 12 && cur; d++) {
          const block = cur.innerText || "";
          if (
            block.length > 120 &&
            block.length < 8000 &&
            /principal\s*(?:&|and)\s*interest/i.test(block) &&
            /property taxes/i.test(block) &&
            /home insurance/i.test(block)
          ) {
            return cur;
          }
          cur = cur.parentElement;
        }
      }
      const explore = Array.from(
        document.querySelectorAll("p,span,div,h2,h3"),
      ).find((el) =>
        /explore the cost of this home/i.test(el.textContent || ""),
      );
      if (explore) {
        let cur = explore;
        for (let d = 0; d < 14 && cur; d++) {
          const block = cur.innerText || "";
          if (
            block.length > 120 &&
            block.length < 8000 &&
            /payment breakdown/i.test(block) &&
            /property taxes/i.test(block)
          ) {
            return cur;
          }
          cur = cur.parentElement;
        }
      }
      const blocks = document.querySelectorAll("section,article,div");
      let best = null;
      let bestLen = Infinity;
      for (const el of blocks) {
        const block = el.innerText || "";
        if (block.length < 200 || block.length > 5500) continue;
        if (
          !/principal\s*(?:&|and)\s*interest/i.test(block) ||
          !/mortgage insurance/i.test(block) ||
          !/property taxes/i.test(block) ||
          !/home insurance/i.test(block) ||
          !/hoa fees?/i.test(block)
        ) {
          continue;
        }
        if (
          /tax history|price history|public record|assessment|prior year/i.test(
            block,
          )
        ) {
          continue;
        }
        if (block.length < bestLen) {
          bestLen = block.length;
          best = el;
        }
      }
      return best;
    }

    function paymentBreakdownBand(block) {
      const i1 = block.search(/\bpayment breakdown\b/i);
      const i2 = block.search(/\bexplore the cost of this home\b/i);
      let start = -1;
      if (i1 >= 0) start = start < 0 ? i1 : Math.min(start, i1);
      if (i2 >= 0) start = start < 0 ? i2 : Math.min(start, i2);
      if (start < 0) return { band: block, anchored: false };
      let band = block.slice(start);
      const u = band.search(/\butilities\b/i);
      if (u >= 0) band = band.slice(0, Math.min(u + 100, band.length));
      return { band, anchored: true };
    }

    function normalizeRowLine(node) {
      return (node.innerText || "")
        .replace(/\r/g, "\n")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" ")
        .trim();
    }

    /** Real widget: list under “Payment breakdown” heading (stable across many layouts). */
    function extractStrictPaymentUl() {
      const o = emptyOut();
      const headings = document.querySelectorAll("h2,h3,h4,h5,h6");
      for (const h of headings) {
        if (!/payment breakdown/i.test((h.textContent || "").trim())) continue;
        let container = h.parentElement;
        for (let depth = 0; depth < 14 && container; depth++) {
          const uls = container.querySelectorAll("ul");
          for (const ul of uls) {
            const lis = ul.querySelectorAll(":scope > li");
            if (lis.length < 4 || lis.length > 14) continue;
            const tmp = emptyOut();
            let hits = 0;
            for (const li of lis) {
              const line = normalizeRowLine(li);
              if (line.length < 4 || line.length > 220) continue;
              const low = line.toLowerCase();
              if (/\brent\b|\bzestimate\b.*\brent\b|\blease\b/.test(low)) {
                continue;
              }
              const val = dollarsInLine(line);
              if (val == null) continue;
              if (
                /principal\s*(?:&|and)\s*interest/.test(low) &&
                tmp.principal_and_interest == null
              ) {
                tmp.principal_and_interest = val;
                hits++;
              } else if (
                (/mortgage insurance/.test(low) ||
                  /private mortgage/.test(low)) &&
                tmp.mortgage_insurance == null
              ) {
                tmp.mortgage_insurance = val;
                hits++;
              } else if (
                /property taxes/.test(low) &&
                tmp.property_taxes_monthly == null
              ) {
                tmp.property_taxes_monthly = val;
                hits++;
              } else if (
                /\bhome insurance\b/.test(low) &&
                tmp.home_insurance_monthly == null
              ) {
                tmp.home_insurance_monthly = val;
                hits++;
              } else if (
                /\bhoa fees?\b|\bmonthly\s*hoa\b/.test(low) &&
                tmp.hoa_fees_monthly == null
              ) {
                tmp.hoa_fees_monthly = val;
                hits++;
              }
            }
            if (hits >= 3) return tmp;
          }
          container = container.parentElement;
        }
      }
      return o;
    }

    function scrapeFromRowInto(o, el) {
      if (!el?.querySelectorAll) return;
      const rows = el.querySelectorAll('li, tr, [role="row"]');
      for (const node of rows) {
        const line = normalizeRowLine(node);
        if (line.length < 6 || line.length > 220) continue;
        const low = line.toLowerCase();
        if (/\brent\b|\bzestimate\b.*\brent\b|\blease\b/.test(low)) continue;
        const val = dollarsInLine(line);
        if (val == null) continue;
        if (debug && /\$\s*[\d,]+/.test(line)) {
          if (
            /principal|mortgage insurance|property tax|home insurance|hoa/i.test(
              low,
            )
          ) {
            rowSnippets.push(line.slice(0, 120));
          }
        }
        if (
          /principal\s*(?:&|and)\s*interest/.test(low) &&
          o.principal_and_interest == null
        ) {
          o.principal_and_interest = val;
        } else if (
          (/mortgage insurance/.test(low) || /private mortgage/.test(low)) &&
          o.mortgage_insurance == null
        ) {
          o.mortgage_insurance = val;
        } else if (/property taxes/.test(low) && o.property_taxes_monthly == null) {
          o.property_taxes_monthly = val;
        } else if (
          /\bhome insurance\b/.test(low) &&
          o.home_insurance_monthly == null
        ) {
          o.home_insurance_monthly = val;
        } else if (
          /\bhoa fees?\b|\bmonthly\s*hoa\b/.test(low) &&
          o.hoa_fees_monthly == null
        ) {
          o.hoa_fees_monthly = val;
        }
      }
    }

    function extractBandOnly(band, anchored, fullText) {
      const o = emptyOut();
      fillFromBandInto(o, band);
      if (!anchored) fallfillInto(o, fullText);
      utilitiesFromBand(o, band);
      return o;
    }

    function extractHybrid(root, band, anchored, fullText) {
      const o = emptyOut();
      fillFromBandInto(o, band);
      if (root) scrapeFromRowInto(o, root);
      if (!anchored) fallfillInto(o, fullText);
      utilitiesFromBand(o, band);
      return o;
    }

    /**
     * u = strict UL (weight 3), h = hybrid (2), b = band-only (1).
     * Two equal votes win; else prefer higher-weight non-null; three-way split → median.
     */
    function consensusNumeric(u, h, b) {
      const scored = [
        { v: u, w: 3 },
        { v: h, w: 2 },
        { v: b, w: 1 },
      ].filter((x) => x.v != null && Number.isFinite(x.v));
      if (scored.length === 0) return null;
      if (scored.length === 1) return scored[0].v;
      const vals = scored.map((x) => x.v);
      const freq = new Map();
      for (const v of vals) freq.set(v, (freq.get(v) || 0) + 1);
      for (const [v, n] of freq) {
        if (n >= 2) return v;
      }
      if (scored.length === 2) {
        const [hi, lo] =
          scored[0].w >= scored[1].w
            ? [scored[0], scored[1]]
            : [scored[1], scored[0]];
        return hi.v;
      }
      vals.sort((x, y) => x - y);
      return vals[1];
    }

    const root = findPaymentBreakdownRoot();
    const text = (root ?? document.body)?.innerText ?? "";
    const { band, anchored } = paymentBreakdownBand(text);

    const strictUl = extractStrictPaymentUl();
    const hybrid = extractHybrid(root, band, anchored, text);
    const bandOnly = extractBandOnly(band, anchored, text);

    const out = emptyOut();
    const numKeys = [
      "principal_and_interest",
      "mortgage_insurance",
      "property_taxes_monthly",
      "home_insurance_monthly",
      "hoa_fees_monthly",
    ];
    for (const k of numKeys) {
      out[k] = consensusNumeric(strictUl[k], hybrid[k], bandOnly[k]);
    }
    out.utilities =
      hybrid.utilities ?? bandOnly.utilities ?? strictUl.utilities ?? null;

    const debugInfo = debug
      ? {
          anchored,
          bandHead: band.slice(0, 450),
          rowSnippets: rowSnippets.slice(0, 22),
          strictUl,
          hybrid,
          bandOnly,
          merged: { ...out },
        }
      : null;
    return { payment: out, debugInfo };
  }, debug);
  if (debugInfo) {
    console.error("[zillow payment DOM]", JSON.stringify(debugInfo, null, 2));
  }
  return payment;
}

function browserLog(verbose, message) {
  if (verbose) console.error(`[zillow-browser] ${message}`);
}

/** Same-site referer helps some edges that reject “cold” listing/search hits with HTTP 403. */
function gotoOptionsForZillowUrl(targetUrl) {
  const opts = { waitUntil: "domcontentloaded" };
  try {
    const u = new URL(targetUrl);
    const host = u.hostname.toLowerCase();
    if (host.endsWith("zillow.com") && u.pathname !== "/") {
      opts.referer = "https://www.zillow.com/";
    }
  } catch {
    /* ignore */
  }
  return opts;
}

function humanizeRandomPauseMs() {
  const lo = Math.min(ZILLOW_HUMANIZE_MS_MIN, ZILLOW_HUMANIZE_MS_MAX);
  const hi = Math.max(ZILLOW_HUMANIZE_MS_MIN, ZILLOW_HUMANIZE_MS_MAX);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * Light mouse paths + stepped wheel scroll so the session looks less like a single static navigation.
 * Best-effort: failures are ignored so scrapes still run.
 */
async function humanizePage(page, verbose, label) {
  if (!ZILLOW_HUMANIZE) return;
  try {
    const vp = page.viewportSize();
    const w = vp?.width ?? 1920;
    const h = vp?.height ?? 1080;
    const moves = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < moves; i++) {
      const x = 80 + Math.random() * (w - 160);
      const y = 80 + Math.random() * (h - 160);
      const steps = 8 + Math.floor(Math.random() * 18);
      await page.mouse.move(x, y, { steps });
      await new Promise((r) =>
        setTimeout(r, applyTimingJitter(90, 60)),
      );
    }
    const scrollChunks = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < scrollChunks; i++) {
      await page.mouse.wheel(0, 90 + Math.floor(Math.random() * 160));
      await new Promise((r) =>
        setTimeout(r, 40 + Math.floor(Math.random() * 100)),
      );
    }
    await new Promise((r) => setTimeout(r, humanizeRandomPauseMs()));
    browserLog(verbose, `humanize: ${label}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    browserLog(verbose, `humanize: ${label} skipped (${msg})`);
  }
}

async function applyStealthInitScript(context) {
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    } catch {
      /* ignore */
    }
    try {
      const c = window.chrome;
      if (c && typeof c === "object" && !("runtime" in c)) {
        Object.defineProperty(c, "runtime", {
          configurable: true,
          enumerable: true,
          value: {},
        });
      }
    } catch {
      /* ignore */
    }
  });
}

async function getBrowser(verbose = false) {
  if (!browserPromise) {
    browserLog(verbose, "launching Chromium…");
    const dsf = BROWSER_DEVICE_SCALE_FACTOR;
    browserPromise = chromium.launch({
      headless: !HEADFUL,
      ...(PLAYWRIGHT_CHANNEL ? { channel: PLAYWRIGHT_CHANNEL } : {}),
      args: [
        ...CHROMIUM_ARGS,
        `--force-device-scale-factor=${dsf}`,
      ],
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

async function withPage(fn, { verbose = false } = {}) {
  const browser = await getBrowser(verbose);
  browserLog(verbose, "new context + page");
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: BROWSER_DEVICE_SCALE_FACTOR,
    extraHTTPHeaders: BROWSER_EXTRA_HEADERS,
    javaScriptEnabled: true,
    ...(PLAYWRIGHT_PROXY ? { proxy: PLAYWRIGHT_PROXY } : {}),
  });
  await applyStealthInitScript(context);
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
  const scrapeDomPayment =
    Boolean(options.scrapeDomPayment) && PAYMENT_DOM_SCRAPE;
  const verbose = Boolean(options.verbose);
  const skipWarmup = Boolean(options.skipWarmup);
  if (verbose && Boolean(options.scrapeDomPayment) && !PAYMENT_DOM_SCRAPE) {
    browserLog(
      true,
      "payment DOM scrape off (PAYMENT_DOM_SCRAPE=0); using embedded JSON for payment fields only",
    );
  }
  return withPage(async (page) => {
    let challengeHoldActive = false;
    try {
      let host = "";
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        /* validated upstream */
      }
    if (ZILLOW_WARMUP && !skipWarmup && host.endsWith("zillow.com")) {
      browserLog(verbose, "warm-up: loading zillow.com …");
      await page
        .goto("https://www.zillow.com/", gotoOptionsForZillowUrl("https://www.zillow.com/"))
        .catch(() => {});
      const settle = Math.max(0, ZILLOW_WARMUP_MS);
      if (settle > 0) {
        browserLog(verbose, `warm-up: settle ${settle}ms`);
        await new Promise((r) => setTimeout(r, settle));
      }
      await humanizePage(page, verbose, "after warm-up");
    } else if (skipWarmup && verbose && host.endsWith("zillow.com")) {
      browserLog(verbose, "warm-up: skipped (retry / skipWarmup)");
    }

    browserLog(verbose, `navigate: ${url} (waitUntil=domcontentloaded)`);
    let response;
    try {
      response = await page.goto(url, gotoOptionsForZillowUrl(url));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Navigation failed: ${msg}`);
    }
    if (!response) {
      throw new Error("No response from navigation");
    }
    browserLog(verbose, `navigation HTTP ${response.status()}`);
    if (response.status() >= 400) {
      throw new Error(`Page returned HTTP ${response.status()}`);
    }
    await humanizePage(page, verbose, "after navigation");
    if (ZILLOW_CHALLENGE_HOLD) {
      const w = Math.max(0, ZILLOW_CHALLENGE_HOLD_WAIT_MS);
      if (w > 0) {
        browserLog(verbose, `challenge hold: pre-lookup wait ${w}ms`);
        await new Promise((r) => setTimeout(r, w));
      }
      challengeHoldActive = await tryStartPressAndHold(page, { verbose });
    }
    browserLog(verbose, "waiting for __NEXT_DATA__ …");
    try {
      await page.waitForFunction(
        () => {
          const el = document.getElementById("__NEXT_DATA__");
          return el && el.textContent && el.textContent.length > 10;
        },
        { timeout: NAV_TIMEOUT_MS },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Timed out or failed waiting for __NEXT_DATA__ (${NAV_TIMEOUT_MS}ms): ${msg}`,
      );
    }
    browserLog(verbose, "__NEXT_DATA__ present");
    if (!scrapeDomPayment && SEARCH_SETTLE_MS > 0) {
      const searchSettle = applyTimingJitter(
        SEARCH_SETTLE_MS,
        DOM_TIMING_JITTER_MS,
      );
      browserLog(verbose, `search settle ${searchSettle}ms (±${DOM_TIMING_JITTER_MS})`);
      await new Promise((r) => setTimeout(r, searchSettle));
    }
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
      throw new Error("Could not parse __NEXT_DATA__ JSON");
    }
    browserLog(verbose, "parsed __NEXT_DATA__");

    let domPayment = null;
    if (scrapeDomPayment && /homedetails/i.test(url)) {
      browserLog(verbose, "payment DOM: scroll + wait …");
      const total = resolvePaymentDomWaitTotalMs();
      const beforeScroll = Math.min(5000, total);
      const afterScroll = Math.max(0, total - beforeScroll);
      const settleMs = applyTimingJitter(
        PAYMENT_DOM_SETTLE_MS,
        DOM_TIMING_JITTER_MS,
      );
      const totalNote = PAYMENT_DOM_WAIT_RANDOM_RANGE
        ? `random ${PAYMENT_DOM_WAIT_MS_MIN}–${PAYMENT_DOM_WAIT_MS_MAX}`
        : `±${DOM_TIMING_JITTER_MS} jitter on base`;
      browserLog(
        verbose,
        `payment waits total=${total}ms (${totalNote}) pre/post scroll, settle=${settleMs}ms`,
      );
      await new Promise((r) => setTimeout(r, beforeScroll));
      await page
        .evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, afterScroll));
      await new Promise((r) => setTimeout(r, settleMs));
      domPayment = await scrapePaymentBreakdownDom(page, {
        debug: PAYMENT_DEBUG,
      });
      browserLog(verbose, "payment DOM scrape done");
    }

    return { nextData: raw, domPayment };
    } finally {
      if (challengeHoldActive) {
        await releasePressAndHold(page);
        browserLog(verbose, "challenge: press-and-hold released");
      }
    }
  }, { verbose });
}
