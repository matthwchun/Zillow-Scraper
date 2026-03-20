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

## Using with n8n Cloud

Typical flow:

1. **HTTP Request** → `POST /search` with `searchUrl` from your workflow (or a static search URL).
2. Use n8n’s **Item Lists**, **Code**, or **Split Out** to keep only the **top 10–15** (or any slice) from `listings`—the service does **not** cap results.
3. For each chosen row, **HTTP Request** → `POST /details` with `listingUrl` (or construct URL from `listing_id` if you prefer).
4. **Google Sheets** (or another destination) to append/update rows from the combined data.

This keeps scraper calls bounded in n8n while the API always returns **everything on the first Zillow page** it receives.

---

## How it works

- Launches **headless Chromium** with flags suitable for containers (`--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, etc.).
- Opens the URL once, waits for `__NEXT_DATA__`, parses JSON.
- **Search:** reads `searchPageState` / `initialSearchPageState` style structures (`mapResults`, `listResults`), dedupes by `listing_id`.
- **Details:** prefers `gdpClientCache` (and shallow discovery under `pageProps`) and maps to the response schema.
- **One browser** is reused; each request uses a **new page** that is **closed** afterward. The browser is closed on **SIGINT/SIGTERM**.
- Navigation timeout: **60s** (adjust in `server.js` if needed).

---

## Known limitations

- Zillow’s internal JSON **changes without notice**; extractions may need updates.
- Some fields are often **missing** depending on listing type and page.
- **Captcha, geo blocks, or bot detection** can cause failures (HTTP 502 / scrape errors).
- **`Page returned HTTP 403`:** Zillow refused the request before HTML was served. Try, in order:
  1. Restart the server after pulling the latest code (fixes include no fake `Sec-Fetch-*` on every request, optional warm-up to `https://www.zillow.com/` first).
  2. **Windows:** install [Google Chrome](https://www.google.com/chrome/), set in `.env` **`PLAYWRIGHT_CHANNEL=chrome`**, restart, run `npx playwright install` if prompted—real Chrome often fares better than bundled Chromium.
  3. Set **`HEADFUL=1`** locally so a real window opens (sometimes only headless is blocked).
  4. Disable warm-up if it hurts: **`ZILLOW_WARMUP=0`**.
  5. Different network / time of day; cloud IPs (e.g. Render) are often blocked—there is no guaranteed fix in code alone.
- **Terms of use:** ensure your use complies with Zillow’s policies and applicable law.

---

## License

Use at your own risk; no affiliation with Zillow.
