import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function bodyJsonPath() {
  return resolve(process.cwd(), "body.json");
}

export function outputJsonPath() {
  return resolve(process.cwd(), "output.json");
}

export function writeOutput(obj) {
  writeFileSync(outputJsonPath(), `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

export function readBodyJson() {
  const raw = readFileSync(bodyJsonPath(), "utf8");
  return JSON.parse(raw);
}
