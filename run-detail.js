import "dotenv/config";
import { closeBrowser, fetchNextData } from "./lib/zillow-browser.js";
import { extractDetailListing } from "./lib/zillow-extract.js";
import { assertZillowUrl } from "./lib/utils.js";
import {
  readBodyObject,
  writeOutput,
  writeInvalidInput,
  writeRunningPlaceholder,
  writeDetailFailure,
  outputJsonPath,
  bodyJsonPath,
} from "./lib/io.js";
import { withRetry } from "./lib/retry.js";
import { cliLog } from "./lib/cli-log.js";
import {
  CLI_RETRY_DELAY_MS,
  resolveCliRetryDelayAfterError,
  ZILLOW_WARMUP,
  ZILLOW_WARMUP_MS,
  HEADFUL,
  PLAYWRIGHT_CHANNEL,
  PAYMENT_DOM_WAIT_MS,
  PAYMENT_DOM_WAIT_RANDOM_RANGE,
  PAYMENT_DOM_WAIT_MS_MIN,
  PAYMENT_DOM_WAIT_MS_MAX,
} from "./lib/config.js";

const MAX_ATTEMPTS = 2;

async function main() {
  cliLog("start", {
    mode: "detail",
    script: "run-detail.js",
    cwd: process.cwd(),
    bodyJson: bodyJsonPath(),
    outputJson: outputJsonPath(),
  });
  cliLog("env_effective", {
    PLAYWRIGHT_CHANNEL: PLAYWRIGHT_CHANNEL ?? null,
    HEADFUL,
    ZILLOW_WARMUP,
    ZILLOW_WARMUP_MS,
    retrySkipsWarmup: true,
    PAYMENT_DOM_WAIT_RANDOM_RANGE,
    PAYMENT_DOM_WAIT_MS_MIN: PAYMENT_DOM_WAIT_RANDOM_RANGE
      ? PAYMENT_DOM_WAIT_MS_MIN
      : null,
    PAYMENT_DOM_WAIT_MS_MAX: PAYMENT_DOM_WAIT_RANDOM_RANGE
      ? PAYMENT_DOM_WAIT_MS_MAX
      : null,
    PAYMENT_DOM_WAIT_MS: PAYMENT_DOM_WAIT_RANDOM_RANGE ? null : PAYMENT_DOM_WAIT_MS,
    CLI_RETRY_DELAY_MS,
  });

  let listingUrl;
  try {
    const body = readBodyObject();
    cliLog("body_json", { ok: true });
    const raw = body.listingUrl;
    if (!raw || typeof raw !== "string" || !raw.trim()) {
      writeInvalidInput("body.json must contain a non-empty string listingUrl");
      cliLog("validation_failed", { reason: "missing_or_empty_listingUrl" });
      process.exit(1);
    }
    listingUrl = raw.trim();
    const v = assertZillowUrl(listingUrl, "listingUrl");
    if (v) {
      writeInvalidInput(v);
      cliLog("validation_failed", { reason: "assertZillowUrl", details: v });
      process.exit(1);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeInvalidInput(msg);
    cliLog("invalid_input", { message: msg });
    process.exit(1);
  }

  cliLog("input_valid", { listingUrl });

  writeRunningPlaceholder("detail");

  let exitCode = 0;
  try {
    const detail = await withRetry(
      async (attempt) => {
        cliLog("scrape_attempt", { attempt, maxAttempts: MAX_ATTEMPTS });
        const { nextData, domPayment } = await fetchNextData(listingUrl, {
          scrapeDomPayment: true,
          verbose: true,
          skipWarmup: attempt >= 2,
        });
        cliLog("next_data_ok", {
          hasPageProps: Boolean(nextData?.props?.pageProps),
        });
        const detail = extractDetailListing(
          nextData,
          listingUrl,
          domPayment,
        );
        if (!detail || !detail.listing_id) {
          throw new Error(
            "Could not extract listing details from page JSON (missing listing_id or property data)",
          );
        }
        cliLog("extract_ok", { listing_id: detail.listing_id });
        return detail;
      },
      {
        maxAttempts: MAX_ATTEMPTS,
        delayMs: (err) => resolveCliRetryDelayAfterError(err),
        onRetry: (err, failedAttempt, delayMs) => {
          cliLog("retry", {
            afterAttempt: failedAttempt,
            nextAttempt: failedAttempt + 1,
            delayMs,
            delayReason: /\b403\b/.test(err.message)
              ? "403_backoff"
              : "default",
            error: err.message,
          });
        },
      },
    );

    writeOutput({ success: true, ...detail });
    cliLog("output_written", {
      success: true,
      path: outputJsonPath(),
      listing_id: detail.listing_id,
    });
  } catch (e) {
    exitCode = 1;
    const msg = e instanceof Error ? e.message : String(e);
    writeDetailFailure(msg);
    cliLog("output_written", {
      success: false,
      error: "Detail scrape failed",
      message: msg,
    });
    if (e instanceof Error && e.stack) console.error(e.stack);
  } finally {
    await closeBrowser().catch(() => {});
    cliLog("browser_closed");
  }

  cliLog("exit", { code: exitCode });
  process.exit(exitCode);
}

main().catch(async (e) => {
  const msg = e instanceof Error ? e.message : String(e);
  try {
    writeDetailFailure(`Unexpected: ${msg}`);
  } catch {
    /* ignore disk errors */
  }
  console.error(e);
  await closeBrowser().catch(() => {});
  cliLog("fatal_exit", { message: msg });
  process.exit(1);
});
