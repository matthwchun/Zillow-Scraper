import "dotenv/config";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readBodyObject, writeInvalidInput } from "./lib/io.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function main() {
  let body;
  try {
    body = readBodyObject();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeInvalidInput(msg);
    process.exit(1);
  }

  const hasSearch =
    typeof body.searchUrl === "string" && body.searchUrl.trim() !== "";
  const hasListing =
    typeof body.listingUrl === "string" && body.listingUrl.trim() !== "";

  if (hasSearch && hasListing) {
    writeInvalidInput(
      "body.json must contain only one of searchUrl or listingUrl, not both",
    );
    process.exit(1);
  }

  if (!hasSearch && !hasListing) {
    writeInvalidInput("body.json must contain searchUrl or listingUrl");
    process.exit(1);
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
