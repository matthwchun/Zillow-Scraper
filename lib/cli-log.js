/** stderr diagnostics for CLI / n8n Execute Command (does not pollute output.json). */
export function cliLog(phase, data = {}) {
  const ts = new Date().toISOString();
  const extra = Object.keys(data).length ? ` ${JSON.stringify(data)}` : "";
  console.error(`[zillow-cli ${ts}] ${phase}${extra}`);
}
