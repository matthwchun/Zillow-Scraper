import "dotenv/config";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeOutput } from "./lib/io.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function main() {
  let body;
  try {
    body = JSON.parse(
      readFileSync(resolve(process.cwd(), "body.json"), "utf8"),
    );
  } catch (e) {
    writeOutput({
      success: false,
      error: "Invalid body.json",
      details: e instanceof Error ? e.message : String(e),
    });
    process.exit(1);
    return;
  }

  const hasSearch =
    typeof body.searchUrl === "string" && body.searchUrl.trim() !== "";
  const hasListing =
    typeof body.listingUrl === "string" && body.listingUrl.trim() !== "";

  if (hasSearch && hasListing) {
    writeOutput({
      success: false,
      error: "Validation failed",
      details:
        "body.json must contain only one of searchUrl or listingUrl, not both",
    });
    process.exit(1);
    return;
  }

  if (!hasSearch && !hasListing) {
    writeOutput({
      success: false,
      error: "Validation failed",
      details: "body.json must contain searchUrl or listingUrl",
    });
    process.exit(1);
    return;
  }

  const script = hasSearch ? "run-search.js" : "run-detail.js";
  const r = spawnSync(process.execPath, [resolve(__dirname, script)], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  process.exit(r.status ?? 1);
}

main();
