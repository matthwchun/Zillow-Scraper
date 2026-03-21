import "dotenv/config";
import express from "express";
import { fetchNextData, closeBrowser } from "./lib/zillow-browser.js";
import { extractSearchListings, extractDetailListing } from "./lib/zillow-extract.js";
import { assertZillowUrl } from "./lib/utils.js";
import { withRetry } from "./lib/retry.js";
import {
  PLAYWRIGHT_CHANNEL,
  HEADFUL,
  ZILLOW_WARMUP,
  ZILLOW_WARMUP_MS,
  ZILLOW_HUMANIZE,
  ZILLOW_CHALLENGE_HOLD,
  PAYMENT_DOM_WAIT_MS,
  PAYMENT_DOM_WAIT_RANDOM_RANGE,
  PAYMENT_DOM_WAIT_MS_MIN,
  PAYMENT_DOM_WAIT_MS_MAX,
  PAYMENT_DOM_SCRAPE,
  BROWSER_DEVICE_SCALE_FACTOR,
  PLAYWRIGHT_PROXY,
  resolveCliRetryDelayAfterError,
} from "./lib/config.js";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const API_KEY = process.env.API_KEY ?? "";

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
    const { nextData } = await withRetry(
      async (attempt) =>
        fetchNextData(searchUrl, {
          scrapeDomPayment: false,
          skipWarmup: attempt >= 2,
        }),
      {
        maxAttempts: 2,
        delayMs: (err) => resolveCliRetryDelayAfterError(err),
      },
    );
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
    const { nextData, domPayment } = await withRetry(
      async (attempt) =>
        fetchNextData(listingUrl, {
          scrapeDomPayment: true,
          skipWarmup: attempt >= 2,
        }),
      {
        maxAttempts: 2,
        delayMs: (err) => resolveCliRetryDelayAfterError(err),
      },
    );
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
  console.log(
    `Browser device scale factor: ${BROWSER_DEVICE_SCALE_FACTOR} (BROWSER_DEVICE_SCALE_FACTOR; Chromium --force-device-scale-factor)`,
  );
  console.log("POST /search and POST /details: up to 2 scrape attempts (same as CLI; 2nd skips warm-up)");
  if (ZILLOW_WARMUP) {
    console.log(`Zillow homepage warm-up on (settle ${ZILLOW_WARMUP_MS}ms after hit)`);
  } else {
    console.log("Zillow homepage warm-up disabled (ZILLOW_WARMUP=0)");
  }
  console.log("Target navigation: waitUntil=domcontentloaded");
  if (ZILLOW_HUMANIZE) {
    console.log("Humanize interactions on (mouse + wheel; set ZILLOW_HUMANIZE=0 to disable)");
  } else {
    console.log("Humanize interactions off (ZILLOW_HUMANIZE=0)");
  }
  if (ZILLOW_CHALLENGE_HOLD) {
    console.log(
      "Press-and-hold challenge mode on (ZILLOW_CHALLENGE_HOLD=1; best-effort; may not match Zillow’s widget)",
    );
  }
  if (!PAYMENT_DOM_SCRAPE) {
    console.log("/details: payment DOM scrape off — JSON only (PAYMENT_DOM_SCRAPE=0)");
  } else if (PAYMENT_DOM_WAIT_RANDOM_RANGE) {
    console.log(
      `Payment DOM wait: uniform random ${PAYMENT_DOM_WAIT_MS_MIN}–${PAYMENT_DOM_WAIT_MS_MAX}ms per /details scrape`,
    );
  } else {
    console.log(
      `Payment DOM budget PAYMENT_DOM_WAIT_MS=${PAYMENT_DOM_WAIT_MS} (±DOM_TIMING_JITTER_MS)`,
    );
  }
  if (PLAYWRIGHT_PROXY) {
    console.log("Outbound proxy enabled (PROXY_SERVER)");
  }
});

async function shutdown() {
  console.log("Shutting down...");
  server.close();
  await closeBrowser();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
