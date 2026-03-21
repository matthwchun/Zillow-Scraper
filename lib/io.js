import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export function bodyJsonPath() {
  return resolve(process.cwd(), "body.json");
}

export function outputJsonPath() {
  return resolve(process.cwd(), "output.json");
}

/** Full overwrite of output.json (never append). */
export function writeOutput(obj) {
  const text = `${JSON.stringify(obj, null, 2)}\n`;
  writeFileSync(outputJsonPath(), text, { encoding: "utf8", flag: "w" });
}

export function writeInvalidInput(details) {
  writeOutput({
    success: false,
    error: "Invalid input",
    details: String(details),
  });
}

export function writeRunningPlaceholder(mode) {
  writeOutput({
    success: false,
    error: "Run in progress",
    details: `Scrape running (${mode}). This file is replaced when finished; do not treat as final.`,
    mode,
  });
}

export function writeSearchFailure(details) {
  writeOutput({
    success: false,
    error: "Search scrape failed",
    details: String(details),
  });
}

export function writeDetailFailure(details) {
  writeOutput({
    success: false,
    error: "Detail scrape failed",
    details: String(details),
  });
}

/**
 * Read and parse body.json. Throws Error with a clear message if missing/invalid.
 * @returns {Record<string, unknown>}
 */
export function readBodyObject() {
  const p = bodyJsonPath();
  if (!existsSync(p)) {
    throw new Error(`body.json not found at ${p}`);
  }
  let raw;
  try {
    raw = readFileSync(p, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    raw = raw.trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Cannot read body.json: ${msg}`);
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid JSON in body.json: ${msg}`);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("body.json must contain a JSON object (not null or array)");
  }
  return body;
}

/** @deprecated alias for readBodyObject */
export function readBodyJson() {
  return readBodyObject();
}
