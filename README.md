# Zillow scraper service

Small, stateless **Node.js** HTTP API that loads Zillow pages in **headless Chromium (Playwright)** and returns **JSON** parsed from embedded page data (`__NEXT_DATA__`). Intended for deployment on **Render** and use from **n8n Cloud** (HTTP Request node).

There is **no database**, **no disk persistence**, and **no Apify**. Search returns **only the first page** of results already present in the initial payload (no scrolling, pagination, or `maxItems`).

---

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/health` | None |
| `POST` | `/search` | `Authorization: Bearer <API_KEY>` |
| `POST` | `/details` | `Authorization: Bearer <API_KEY>` |

All JSON error responses look like: `{ "error": "message", "code": "snake_case_id" }`.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Listen port (default `3000`; Render sets this automatically) |
| `API_KEY` | Yes (for `/search` and `/details`) | Shared secret; send as `Authorization: Bearer …` |

Copy `.env.example` to `.env` for local development. On `npm start`, [dotenv](https://github.com/motdotla/dotenv) loads `.env` into `process.env` (including `API_KEY`).

---

## n8n Cloud + your PC (minimal cost, works with Zillow)

**n8n Cloud** must call a **public HTTPS URL**. Your scraper runs on **localhost**, which the internet cannot reach. **Render** (and similar clouds) often get **403** from Zillow unless you pay for a **residential proxy**. The simplest reliable setup without that cost is:

**Your PC runs the API** → **a free tunnel** exposes `localhost:3000` → **n8n** calls the tunnel URL.

### One-time setup (do once)

1. **`.env`** on your PC: set **`API_KEY`** (same value you will put in n8n).
2. Install **`cloudflared`** and expose port **3000**—step-by-step: **[TUNNEL-SETUP.md](./TUNNEL-SETUP.md)** (quick free URL, or stable URL if you have a domain on Cloudflare).
3. In **n8n Cloud**, create a **credential** or header:  
   `Authorization` = `Bearer <your API_KEY>`  
4. In your workflow, use the **HTTP Request** node:
   - **URL:** `https://your-tunnel-host/details` or `/search`  
   - **Method:** POST  
   - **Body:** JSON built in n8n (e.g. `listingUrl` or `searchUrl`) — **not** the `body.json` file; that file is only for local `curl` tests.

### Daily routine (few clicks)

1. Turn on your PC (if it isn’t always on).
2. Double-click **`Start-Zillow-API.bat`** (starts `npm start`). Leave the window open.
3. Start the tunnel (however you configured `cloudflared`—often `cloudflared tunnel run <name>` in a second window, or run as a Windows service after a one-time setup).
4. Run or schedule your **n8n** workflow as usual.

**Even fewer clicks later:** use **Task Scheduler** to run `Start-Zillow-API.bat` and your `cloudflared` command **at sign-in**, so after a reboot everything comes up without you doing anything.

---

## Local setup

```bash
npm install
```

`postinstall` runs `playwright install chromium`. If browsers are missing, run:

```bash
npx playwright install chromium
```

Create `.env` (see `.env.example`), then:

```bash
npm start
```

The server listens on `PORT` (default `3000`).

---

## Local n8n integration (file + Execute Command)

For **local n8n** you can skip the HTTP server and drive the scraper with **two files** and one shell command per run—good for an **Execute Command** node.

### Contract

1. **Input:** write JSON to **`body.json`** in the **repository root** (same folder as `package.json`).
   - Search: `{ "searchUrl": "https://www.zillow.com/..." }`
   - Detail: `{ "listingUrl": "https://www.zillow.com/homedetails/..." }`
2. **Run** one of:
   - `node run-search.js` — expects `searchUrl`
   - `node run-detail.js` — expects `listingUrl`
   - `node run.js` — picks search vs detail from whichever field is present (not both)
3. **Output:** read **`output.json`** from the repo root.
   - **Success (search):** `{ "count": n, "listings": [ ... ] }`
   - **Success (detail):** one JSON object with listing fields (includes `payment_breakdown` when available).
   - **Failure:** `{ "success": false, "error": "...", "details": "..." }` (always valid JSON). The process exits with code **1** on failure.

Environment (`.env`): same Playwright-related variables as the server (`API_KEY` is **not** required for CLI—only for `POST /search` and `POST /details` on the API).

### n8n Execute Command (Windows example)

Run from the repo root (`cd` to your clone):

**Search**

```text
cmd /c "cd /d C:\path\to\Zillow-Scraper && node run-search.js"
```

**Detail**

```text
cmd /c "cd /d C:\path\to\Zillow-Scraper && node run-detail.js"
```

**Auto**

```text
cmd /c "cd /d C:\path\to\Zillow-Scraper && node run.js"
```

Use a preceding node to **write `body.json`** (e.g. **Write Binary File** / **Code** + file write, or copy from a template), then **Execute Command**, then **Read Binary File** / parse **`output.json`**.

npm shortcuts: `npm run run-search`, `npm run run-detail`, `npm run run`.

---

## Render deployment

### Option A: Dashboard (manual)

1. Create a new **Web Service**, connect this repository.
2. **Environment**: Node 20+.
3. **Build command:**

   ```bash
   npm install && npx playwright install chromium chromium-headless-shell
   ```

4. **Start command:**

   ```bash
   npm start
   ```

5. **Environment variables** (Render → **Environment**):

   | Key | Value |
   |-----|--------|
   | **`API_KEY`** | Your secret (required). |
   | **`NODE_VERSION`** | `20` (if not already set by the stack). |
   | **`PLAYWRIGHT_BROWSERS_PATH`** | **`0`** — stores Chromium under `node_modules` so it is **shipped with the deploy**. Without this, Playwright often looks in `~/.cache`, which may be empty at runtime and triggers *“Executable doesn’t exist … chromium_headless_shell”*. |
   | **`PROXY_SERVER`** | *(see below)* — **Usually required** for Zillow on Render (see **Zillow on Render**). Example: `http://gate.provider.com:12345` or `socks5://…`. |
   | **`PROXY_USERNAME`** / **`PROXY_PASSWORD`** | If your proxy needs auth and it’s not in the URL. |

   Do **not** set **`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`** on Render.

6. **Deploy** and note the public URL for n8n. After changing Playwright paths, use **Clear build cache & deploy** once if the browser is still missing.

`npm install` runs `postinstall` (`playwright install chromium`); the build command also installs **`chromium-headless-shell`** (what headless `chromium.launch()` uses) into the same browser directory.

### Option B: Blueprint

This repo includes `render.yaml`. Adjust the service name/plan as needed, set **`API_KEY`** in the Render dashboard (marked `sync: false`), and connect the blueprint to your repo.

**Suggested production settings**

- Enough **RAM** for Chromium (starter or higher is typical).
- **Health check path:** `/health`

---

## API usage

### Health (public)

```bash
curl -sS https://YOUR-SERVICE.onrender.com/health
```

### Search (first page only)

Request body must be JSON with a full **Zillow search results URL** (`zillow.com` only).

```bash
curl -sS -X POST "https://YOUR-SERVICE.onrender.com/search" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"searchUrl\":\"https://www.zillow.com/homes/for_sale/?searchQueryState=...\"}"
```

Response shape:

```json
{
  "count": 0,
  "listings": []
}
```

Each listing includes `listing_id`, `address`, `city`, `state`, `zip`, numeric `price`, `beds`, `baths`, `sqft`, `lat`, `lng`, absolute `listing_url`, and `status` (missing values are `null`).

### Listing details

```bash
curl -sS -X POST "https://YOUR-SERVICE.onrender.com/details" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"listingUrl\":\"https://www.zillow.com/homedetails/...\"}"
```

Returns the selected detail fields (numbers normalized; missing fields `null`), plus **`payment_breakdown`**: estimated monthly **principal & interest**, **mortgage insurance**, **property taxes**, **home insurance**, **HOA**, and **`utilities`**. Values are taken from embedded JSON when available (including the full **`gdpClientCache`** row and **`viewer`**). If those are empty, **`/details`** waits **`PAYMENT_DOM_WAIT_MS`** (default 3500 ms), scrolls to the bottom of the page, then reads the visible **Payment breakdown** labels from the DOM. Tune with **`PAYMENT_DOM_WAIT_MS`** in `.env` if line items load slowly.

---

## Using with n8n

### n8n on the same computer as the scraper (simplest)

**Option 1 — HTTP:** No tunnel needed. Start **`npm start`** (API on `http://localhost:3000`), run **n8n** locally ([self-host n8n](https://docs.n8n.io/hosting/installation/npm/) or desktop). **HTTP Request** → `http://localhost:3000/details` or `/search`, header **`Authorization: Bearer <API_KEY>`**, JSON body.

**Option 2 — Execute Command (no API, no API_KEY):** Write **`body.json`**, run **`node run-search.js`** / **`node run-detail.js`** / **`node run.js`**, read **`output.json`**. Full contract is in **Local n8n integration** (earlier in this README).

### n8n Cloud

If the API runs **only on your PC**, n8n Cloud cannot reach `localhost`—use a **tunnel** (see **n8n Cloud + your PC** above) and set the HTTP Request URL to your tunnel host + `/search` or `/details`.

### Typical workflow (search → details → Sheets)

Typical flow:

1. **HTTP Request** → `POST /search` with `searchUrl` from your workflow (or a static search URL).
2. Use n8n’s **Item Lists**, **Code**, or **Split Out** to keep only the **top 10–15** (or any slice) from `listings`—the service does **not** cap results.
3. For each chosen row, **HTTP Request** → `POST /details` with `listingUrl` (or construct URL from `listing_id` if you prefer).
4. **Google Sheets** (or another destination) to append/update rows from the combined data.

This keeps scraper calls bounded in n8n while the API always returns **everything on the first Zillow page** it receives.

---

## How it works

- Launches **headless Chromium** with flags suitable for containers (`--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, etc.).
- Optional **`PROXY_SERVER`**: all browser traffic (Zillow only in this app) goes through that proxy—typical for **Render** when Zillow returns **403** for datacenter IPs.
- Opens the URL once, waits for `__NEXT_DATA__`, parses JSON.
- **Search:** reads `searchPageState` / `initialSearchPageState` style structures (`mapResults`, `listResults`), dedupes by `listing_id`.
- **Details:** prefers `gdpClientCache` (and shallow discovery under `pageProps`) and maps to the response schema.
- **One browser** is reused; each request uses a **new page** that is **closed** afterward. The browser is closed on **SIGINT/SIGTERM**.
- Navigation timeout: **60s** (adjust in `server.js` if needed).

---

## Zillow on Render (`HTTP 403`)

Render (and most cloud providers) use **datacenter IPs**. Zillow often responds with **403** to those addresses, so the app can be **healthy** while **`/search`** and **`/details`** fail with `Page returned HTTP 403`.

**Practical fix:** subscribe to a **residential** or **mobile** proxy (or a provider that markets “Zillow-compatible” / anti-detect residential exit IPs). In Render → **Environment**, set:

- **`PROXY_SERVER`** — e.g. `http://hostname:port` or `socks5://hostname:port` (some dashboards give a full URL with `http://user:pass@host:port`).
- **`PROXY_USERNAME`** / **`PROXY_PASSWORD`** — if required and not already in `PROXY_SERVER`.

Redeploy, check logs for **`Outbound proxy enabled`**, then retry your scrape.

**Cheap datacenter proxies usually still get 403** on Zillow. Compliance with Zillow’s terms and applicable law is your responsibility.

---

## Known limitations

- Zillow’s internal JSON **changes without notice**; extractions may need updates.
- Some fields are often **missing** depending on listing type and page.
- **Captcha, geo blocks, or bot detection** can cause failures (HTTP 502 / scrape errors).
- **`Page returned HTTP 403`:** Zillow refused the request before HTML was served. On **your PC**, try Chrome / `HEADFUL` (see below). On **Render**, use **`PROXY_SERVER`** (residential proxy). Otherwise try, in order:
  1. Restart the server after pulling the latest code (fixes include no fake `Sec-Fetch-*` on every request, optional warm-up to `https://www.zillow.com/` first).
  2. **Windows:** install [Google Chrome](https://www.google.com/chrome/), set in `.env` **`PLAYWRIGHT_CHANNEL=chrome`**, restart, run `npx playwright install` if prompted—real Chrome often fares better than bundled Chromium.
  3. Set **`HEADFUL=1`** locally so a real window opens (sometimes only headless is blocked).
  4. Disable warm-up if it hurts: **`ZILLOW_WARMUP=0`**.
  5. Different network / time of day. On **Render**, use a **residential proxy** via **`PROXY_SERVER`** (see **Zillow on Render**).
- **Terms of use:** ensure your use complies with Zillow’s policies and applicable law.

---

## License

Use at your own risk; no affiliation with Zillow.
