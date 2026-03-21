import "dotenv/config";
import { fetchNextData } from "./lib/zillow-browser.js";
import { extractDetailListing } from "./lib/zillow-extract.js";
import { assertZillowUrl } from "./lib/utils.js";
import { readBodyJson, writeOutput } from "./lib/io.js";

function fail(error, details, code = 1) {
  writeOutput({
    success: false,
    error,
    details: String(details),
  });
  process.exit(code);
}

async function main() {
  let body;
  try {
    body = readBodyJson();
  } catch (e) {
    fail("Invalid body.json", e instanceof Error ? e.message : String(e), 1);
    return;
  }

  const listingUrl = body.listingUrl;
  if (!listingUrl || typeof listingUrl !== "string") {
    fail(
      "Validation failed",
      "body.json must contain a string listingUrl for run-detail.js",
      1,
    );
    return;
  }

  const v = assertZillowUrl(listingUrl, "listingUrl");
  if (v) fail("Validation failed", v, 1);

  try {
    const { nextData, domPayment } = await fetchNextData(listingUrl, {
      scrapeDomPayment: true,
    });
    const detail = extractDetailListing(nextData, listingUrl, domPayment);
    if (!detail || !detail.listing_id) {
      fail(
        "Detail scrape failed",
        "Could not extract listing details from page JSON",
        1,
      );
      return;
    }
    writeOutput(detail);
    process.exit(0);
  } catch (e) {
    fail(
      "Detail scrape failed",
      e instanceof Error ? e.message : String(e),
      1,
    );
  }
}

main();
