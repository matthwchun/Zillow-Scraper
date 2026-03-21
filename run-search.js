import "dotenv/config";
import { fetchNextData } from "./lib/zillow-browser.js";
import { extractSearchListings } from "./lib/zillow-extract.js";
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

  const searchUrl = body.searchUrl;
  if (!searchUrl || typeof searchUrl !== "string") {
    fail(
      "Validation failed",
      "body.json must contain a string searchUrl for run-search.js",
      1,
    );
    return;
  }

  const v = assertZillowUrl(searchUrl, "searchUrl");
  if (v) fail("Validation failed", v, 1);

  try {
    const { nextData } = await fetchNextData(searchUrl, {
      scrapeDomPayment: false,
    });
    const listings = extractSearchListings(nextData);
    writeOutput({ count: listings.length, listings });
    process.exit(0);
  } catch (e) {
    fail(
      "Search scrape failed",
      e instanceof Error ? e.message : String(e),
      1,
    );
  }
}

main();
