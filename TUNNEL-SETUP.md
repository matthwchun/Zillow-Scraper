# Expose your local API to n8n Cloud (Cloudflare Tunnel)

Your scraper runs on **your PC**. n8n Cloud needs a **public HTTPS URL**. This guide uses **Cloudflare Tunnel** (`cloudflared`)—**free**.

---

## Before you start

1. App works locally: `npm start` → open `http://localhost:3000/health` → you see `{"ok":true,...}`.
2. **`.env`** has **`API_KEY`** set (you will use the same value in n8n as `Bearer …`).

---

## Option A — Quick tunnel (fastest, ~2 minutes)

**Good for:** testing.  
**Downside:** The `https://….trycloudflare.com` URL **changes** every time you restart `cloudflared` (update n8n if that happens), or leave the tunnel running.

### 1. Install `cloudflared` (Windows)

- Download: [Cloudflare — Install cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) → **Windows** → grab the `.msi` or binary.
- Install it, then open a **new** PowerShell or Git Bash and run:

  ```bash
  cloudflared --version
  ```

  If that fails, add the install folder to your PATH or use the full path to `cloudflared.exe`.

### 2. Start your API

- Double-click **`Start-Zillow-API.bat`**, or run `npm start` in the project folder.  
- Leave it running.

### 3. Start the quick tunnel

In a **second** terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

After a few seconds it prints a URL like:

`https://random-words-1234.trycloudflare.com`

**Copy that full URL** (including `https://`).

#### When the hostname changes — where to look

The new URL **only** appears in the **same terminal where `cloudflared` is running**, a few seconds after you start it. Scroll up if needed and find the line that contains **`trycloudflare.com`** (it always starts with `https://`).

**Easiest habit:** keep that terminal window **open and visible** (don’t close it after startup) so you can always re-read the URL. If you restart `cloudflared`, watch that window again for the new line.

**To avoid hunting in n8n:** configure the base URL in **one place** only:

- **n8n Cloud → Settings → Variables** (or your project’s **Variables**, depending on version): create something like `ZILLOW_SCRAPER_BASE` = `https://your-subdomain.trycloudflare.com` (**no** trailing slash).
- In the **HTTP Request** node, set **URL** to an expression, e.g. `{{ $vars.ZILLOW_SCRAPER_BASE }}/details` (adjust to match [n8n’s variable syntax](https://docs.n8n.io/code/variables/) for your version—some UIs use `{{ $vars["ZILLOW_SCRAPER_BASE"] }}/details`).

When the tunnel gives you a new host, **change that single variable** (or one **Set** node at the start of the workflow that every other node reads from). You do **not** need to edit every HTTP node if they all reference the variable.

**Zero URL churn:** use **Option B** (named tunnel + your domain) so the hostname **never** changes in n8n.

### 4. Test from the internet

Replace `HOST` with your tunnel host (no trailing slash):

```bash
curl.exe --ssl-no-revoke -sS "https://HOST/health"
```

You should see the same JSON as localhost.

### 5. Wire n8n Cloud

In an **HTTP Request** node:

| Field | Value |
|--------|--------|
| **Method** | `POST` |
| **URL** | `https://HOST/details` or `https://HOST/search` |
| **Authentication** | Generic Header, or add header manually: `Authorization` = `Bearer YOUR_API_KEY` |
| **Body** | JSON, e.g. `{"listingUrl":"https://www.zillow.com/homedetails/..."}` |

Use the **exact** `API_KEY` from your `.env`.

### 6. Daily habit

1. Start **`Start-Zillow-API.bat`** (or `npm start`).  
2. Run **`cloudflared tunnel --url http://localhost:3000`** again.  
3. If the URL changed, update **one** n8n Variable (or one Set node)—see above. If you **don’t** stop `cloudflared`, the quick-tunnel URL often stays valid until the PC sleeps or the tunnel process dies.

---

## Option B — Stable URL (needs a domain you control)

**Good for:** same link in n8n forever.  
**Cost:** You need a **domain name** (~$10–20/year) added to Cloudflare DNS (DNS on Cloudflare’s **free** plan is fine).

1. Add your domain to Cloudflare and use their nameservers (follow Cloudflare’s onboarding).
2. In [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → **Create a tunnel**.
3. Name it (e.g. `zillow-scraper`), install the connector on your PC using the command they show (it uses `cloudflared service install` or a one-time token).
4. Add a **Public hostname**: e.g. `zillow-api.yourdomain.com` → `http://localhost:3000` (HTTP on your machine).
5. In n8n use: `https://zillow-api.yourdomain.com/details` (and the same Bearer token).

Official walkthrough: [Connect an application](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/).

---

## Tips

- **Firewall:** Windows may ask to allow `node` / `cloudflared` the first time.  
- **PC must be on** when n8n runs.  
- **Sleep:** disable sleep for the hours n8n runs, or schedule workflows when the PC is awake.  
- **Task Scheduler (optional):** run `Start-Zillow-API.bat` and your `cloudflared` command **At log on** so you don’t open them by hand.

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| n8n timeout | PC asleep? API running? Tunnel running? |
| 401 from your API | `Bearer` token must match `.env` `API_KEY` exactly. |
| 502 / scrape errors from Zillow | Same as local—Zillow blocking; your home IP usually works better than cloud. |
