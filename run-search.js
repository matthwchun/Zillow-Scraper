import "dotenv/config";
import { closeBrowser, fetchNextData } from "./lib/zillow-browser.js";
import { extractSearchListings } from "./lib/zillow-extract.js";
import { assertZillowUrl } from "./lib/utils.js";
import {
  readBodyObject,
  writeOutput,
  writeInvalidInput,
  writeRunningPlaceholder,
  writeSearchFailure,
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
} from "./lib/config.js";

const MAX_ATTEMPTS = 2;

async function main() {
  cliLog("start", {
    mode: "search",
    script: "run-search.js",
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
    CLI_RETRY_DELAY_MS,
  });

  let searchUrl;
  try {
    const body = readBodyObject();
    cliLog("body_json", { ok: true });
    const raw = body.searchUrl;
    if (!raw || typeof raw !== "string" || !raw.trim()) {
      writeInvalidInput("body.json must contain a non-empty string searchUrl");
      cliLog("validation_failed", { reason: "missing_or_empty_searchUrl" });
      process.exit(1);
    }
    searchUrl = raw.trim();
    const v = assertZillowUrl(searchUrl, "searchUrl");
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

  cliLog("input_valid", { searchUrl });

  writeRunningPlaceholder("search");

  let exitCode = 0;
  try {
    const { listings } = await withRetry(
      async (attempt) => {
        cliLog("scrape_attempt", { attempt, maxAttempts: MAX_ATTEMPTS });
        const { nextData } = await fetchNextData(searchUrl, {
          scrapeDomPayment: false,
          verbose: true,
          skipWarmup: attempt >= 2,
        });
        cliLog("next_data_ok", {
          hasPageProps: Boolean(nextData?.props?.pageProps),
        });
        const listings = extractSearchListings(nextData);
        cliLog("extract_ok", { listingCount: listings.length });
        return { nextData, listings };
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

    writeOutput({
      success: true,
      count: listings.length,
      listings,
    });
    cliLog("output_written", {
      success: true,
      path: outputJsonPath(),
      count: listings.length,
    });
  } catch (e) {
    exitCode = 1;
    const msg = e instanceof Error ? e.message : String(e);
    writeSearchFailure(msg);
    cliLog("output_written", {
      success: false,
      error: "Search scrape failed",
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
    writeSearchFailure(`Unexpected: ${msg}`);
  } catch {
    /* ignore disk errors */
  }
  console.error(e);
  await closeBrowser().catch(() => {});
  cliLog("fatal_exit", { message: msg });
  process.exit(1);
});
