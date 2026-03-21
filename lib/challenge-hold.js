/**
 * Best-effort "press and hold" for bot challenges: left mouse down on a matching control,
 * held until releasePressAndHold(). Selectors and iframes vary by provider — may not find the widget.
 */

/**
 * @param {import('playwright').Page} page
 * @param {{ verbose?: boolean }} [opts]
 * @returns {Promise<boolean>} true if mouse down was started (caller must release)
 */
export async function tryStartPressAndHold(page, opts = {}) {
  const verbose = Boolean(opts.verbose);
  const log = (m) => {
    if (verbose) console.error(`[zillow-challenge-hold] ${m}`);
  };

  for (const frame of page.frames()) {
    const locators = [
      frame.getByRole("button", { name: /press\s+and\s+hold/i }),
      frame.getByRole("button", { name: /^hold$/i }),
      frame.locator("button").filter({ hasText: /press\s+and\s+hold/i }).first(),
      frame.locator("button").filter({ hasText: /hold\s+to\s+continue/i }).first(),
      frame.locator('[class*="hold"]').filter({ hasText: /hold/i }).first(),
    ];

    for (const loc of locators) {
      try {
        const visible = await loc
          .first()
          .isVisible({ timeout: 1200 })
          .catch(() => false);
        if (!visible) continue;
        const box = await loc.first().boundingBox();
        if (!box || box.width < 4 || box.height < 4) continue;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y, { steps: 6 });
        await page.mouse.down({ button: "left" });
        log("mouse down (press-and-hold started)");
        return true;
      } catch {
        /* try next locator */
      }
    }
  }

  log("no press-and-hold control matched (widget may use different markup or iframe)");
  return false;
}

/**
 * @param {import('playwright').Page} page
 */
export async function releasePressAndHold(page) {
  try {
    await page.mouse.up({ button: "left" });
  } catch {
    /* page may be closing */
  }
}
