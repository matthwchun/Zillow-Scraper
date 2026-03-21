import {
  parseNumber,
  normalizeZillowUrl,
  extractZpidFromUrl,
  statusLabel,
} from "./utils.js";

function mergeHomeFragments(...parts) {
  const out = {};
  for (const p of parts) {
    if (p && typeof p === "object") Object.assign(out, p);
  }
  return out;
}

function listingUrlFromParts(zpid, hi, fallbackPath) {
  const direct =
    hi?.hdpUrl ??
    hi?.pdpUrl ??
    hi?.listingUrl ??
    hi?.url ??
    fallbackPath;
  if (direct) return normalizeZillowUrl(direct);
  if (zpid) return normalizeZillowUrl(`/homedetails/${zpid}_zpid/`);
  return null;
}

function mapMergedToSearchListing(zpid, merged, latLong, rawItem) {
  const z = zpid != null ? String(zpid) : null;
  if (!z) return null;

  const lat =
    parseNumber(merged.latitude) ??
    parseNumber(merged.lat) ??
    parseNumber(latLong?.latitude) ??
    parseNumber(rawItem?.latLong?.latitude);
  const lng =
    parseNumber(merged.longitude) ??
    parseNumber(merged.lng) ??
    parseNumber(merged.lon) ??
    parseNumber(latLong?.longitude) ??
    parseNumber(rawItem?.latLong?.longitude);

  const address =
    merged.streetAddress ?? merged.address ?? merged.street ?? null;
  const city = merged.city ?? merged.addressCity ?? null;
  const state = merged.state ?? merged.addressState ?? null;
  const zip = merged.zipcode ?? merged.addressZipcode ?? merged.postalCode ?? null;

  const price =
    parseNumber(merged.price) ??
    parseNumber(merged.unformattedPrice) ??
    parseNumber(merged.amount) ??
    null;
  const beds =
    parseNumber(merged.bedrooms) ??
    parseNumber(merged.beds) ??
    parseNumber(merged.bed) ??
    null;
  const baths =
    parseNumber(merged.bathrooms) ??
    parseNumber(merged.baths) ??
    parseNumber(merged.bath) ??
    null;
  const sqft =
    parseNumber(merged.livingArea) ??
    parseNumber(merged.area) ??
    parseNumber(merged.sqft) ??
    parseNumber(merged.livingAreaValue) ??
    null;

  const detailPath =
    rawItem?.detailUrl ??
    rawItem?.hdpUrl ??
    merged.detailUrl ??
    merged.hdpUrl ??
    null;

  return {
    listing_id: z,
    address,
    city,
    state,
    zip,
    price,
    beds,
    baths,
    sqft,
    lat,
    lng,
    listing_url: listingUrlFromParts(z, merged, detailPath),
    status: statusLabel(merged.homeStatus ?? merged.status ?? rawItem?.statusText),
  };
}

function collectSearchResultsArrays(searchPageState) {
  const arrays = [];
  if (!searchPageState || typeof searchPageState !== "object") return arrays;

  const catKeys = ["cat1", "cat2", "cat3"];
  for (const ck of catKeys) {
    const cat = searchPageState[ck];
    const sr = cat?.searchResults;
    if (!sr) continue;
    if (Array.isArray(sr.mapResults)) arrays.push(sr.mapResults);
    if (Array.isArray(sr.listResults)) arrays.push(sr.listResults);
  }

  const legacy = searchPageState.searchResults;
  if (legacy && typeof legacy === "object") {
    if (Array.isArray(legacy.mapResults)) arrays.push(legacy.mapResults);
    if (Array.isArray(legacy.listResults)) arrays.push(legacy.listResults);
  }

  return arrays;
}

export function extractSearchListings(nextData) {
  const listings = [];
  const seen = new Set();

  const pageProps = nextData?.props?.pageProps;
  if (!pageProps) return listings;

  const stateCandidates = [
    pageProps.searchPageState,
    pageProps.initialSearchPageState,
    pageProps.searchPageStateFromClient,
  ].filter(Boolean);

  for (const sps of stateCandidates) {
    const groups = collectSearchResultsArrays(sps);
    for (const arr of groups) {
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const zpid = item.zpid ?? item.hdpData?.homeInfo?.zpid;
        const hi = item.hdpData?.homeInfo;
        const mini = item.miniCardData;
        const merged = mergeHomeFragments(hi, mini, item);
        const row = mapMergedToSearchListing(zpid, merged, item.latLong ?? merged, item);
        if (row && !seen.has(row.listing_id)) {
          seen.add(row.listing_id);
          listings.push(row);
        }
      }
    }
  }

  return listings;
}

function deepFindGdpClientCache(obj, depth = 0, maxDepth = 8) {
  if (!obj || typeof obj !== "object" || depth > maxDepth) return null;
  if (obj.gdpClientCache && typeof obj.gdpClientCache === "object")
    return obj.gdpClientCache;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const hit = deepFindGdpClientCache(v, depth + 1, maxDepth);
      if (hit) return hit;
    }
  }
  return null;
}

function pickPropertyFromCacheEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  return entry.property ?? entry.listing ?? entry.home ?? entry;
}

function parseGdpClientCache(maybe) {
  if (maybe == null) return null;
  if (typeof maybe === "object" && !Array.isArray(maybe)) return maybe;
  if (typeof maybe === "string") {
    try {
      const parsed = JSON.parse(maybe);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function findGdpCacheRow(cache, zpidWanted) {
  if (!cache || typeof cache !== "object")
    return { entry: null, property: null };
  const want = zpidWanted ? String(zpidWanted) : null;

  for (const val of Object.values(cache)) {
    const prop = pickPropertyFromCacheEntry(val);
    if (!prop || typeof prop !== "object") continue;
    const z = prop.zpid != null ? String(prop.zpid) : null;
    if (want && z === want) return { entry: val, property: prop };
  }

  const first = Object.values(cache)[0];
  return {
    entry: first ?? null,
    property: pickPropertyFromCacheEntry(first),
  };
}

function addressBlock(prop) {
  const a = prop?.address;
  if (a && typeof a === "object") {
    return {
      address: a.streetAddress ?? a.street ?? null,
      city: a.city ?? null,
      state: a.state ?? null,
      zip: a.zipcode ?? a.zip ?? a.postalCode ?? null,
    };
  }
  return {
    address: prop?.streetAddress ?? null,
    city: prop?.city ?? null,
    state: prop?.state ?? null,
    zip: prop?.zipcode ?? prop?.postalCode ?? null,
  };
}

function pickRentEstimate(prop) {
  const r = prop?.rentZestimate ?? prop?.rentZestimateSection;
  if (r == null) return null;
  return parseNumber(r);
}

function pickZestimate(prop) {
  const z = prop?.zestimate ?? prop?.zestimateSection;
  return parseNumber(z);
}

function getOwnNumberCI(obj, ...names) {
  if (!obj || typeof obj !== "object") return null;
  const byLower = new Map();
  for (const k of Object.keys(obj)) {
    byLower.set(k.toLowerCase(), k);
  }
  for (const name of names) {
    const orig = byLower.get(name.toLowerCase());
    if (orig != null) {
      const n = parseNumber(obj[orig]);
      if (n != null) return n;
    }
  }
  return null;
}

function mergePaymentBreakdownNode(target, node) {
  if (!node || typeof node !== "object") return;
  target.principal_and_interest ??= getOwnNumberCI(
    node,
    "principalAndInterest",
    "principalInterest",
    "monthlyPrincipalAndInterest",
    "principalAndInterestPayment",
    "principalAndInt",
    "estimatedMonthlyPaymentPrincipalAndInterest",
    "monthlyPI",
    "piPayment",
  );
  target.mortgage_insurance ??= getOwnNumberCI(
    node,
    "mortgageInsurance",
    "monthlyMortgageInsurance",
    "privateMortgageInsurance",
    "pmi",
    "monthlyPMI",
  );
  target.property_taxes_monthly ??= getOwnNumberCI(
    node,
    "propertyTax",
    "propertyTaxes",
    "monthlyPropertyTax",
    "propertyTaxMonthly",
    "monthlyPropertyTaxes",
    "estimatedMonthlyPropertyTax",
    "monthlyTaxes",
  );
  target.home_insurance_monthly ??= getOwnNumberCI(
    node,
    "homeInsurance",
    "homeownersInsurance",
    "monthlyHomeInsurance",
    "hazardInsurance",
    "homeInsurancePremium",
    "monthlyHomeownersInsurance",
    "estimatedMonthlyHomeInsurance",
    "monthlyHomeownersInsurancePremium",
  );
  target.hoa_fees_monthly ??= getOwnNumberCI(
    node,
    "hoaFees",
    "hoaFee",
    "monthlyHoaFees",
    "monthlyHoaFee",
    "estimatedMonthlyHoaFees",
  );
  if (target.utilities == null) {
    const u = node.utilities ?? node.utilitiesNote ?? node.utilitiesDisclaimer;
    if (typeof u === "string" && u.trim()) {
      target.utilities = u.trim();
    } else if (typeof node.utilitiesIncluded === "boolean") {
      target.utilities = node.utilitiesIncluded ? "Included" : "Not included";
    }
  }
}

function paymentLineItemLabel(item) {
  if (!item || typeof item !== "object") return "";
  const parts = [
    item.type,
    item.componentType,
    item.name,
    item.title,
    item.displayName,
    item.label,
    item.key,
    item.category,
    item.description,
  ];
  return parts
    .filter((x) => x != null && String(x).trim() !== "")
    .join(" ")
    .toUpperCase();
}

function mergePaymentLineItemsFromArray(target, arr) {
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const label = paymentLineItemLabel(item);
    const amt =
      parseNumber(item.amount) ??
      parseNumber(item.monthlyAmount) ??
      parseNumber(item.value) ??
      parseNumber(item.estimatedMonthlyPayment) ??
      parseNumber(item.monthlyPayment);
    if (!label && amt == null) continue;
    if (
      !/\bRENT\b|\bLEASE\b|\bRENTAL\b|\bRENTZESTIMATE\b/i.test(label) &&
      (/PRINCIPAL.*INTEREST|PRINCIPAL\s*&\s*INTEREST|P\s*&\s*I\b|MONTHLY.*PRINCIPAL|ESTIMATED.*P\s*&\s*I/i.test(
        label,
      ) ||
        (label.includes("PRINCIPAL") && label.includes("INTEREST")))
    ) {
      target.principal_and_interest ??= amt;
    } else if (/MORTGAGE.*INS|PMI|PRIVATE.*MORTGAGE|MIP\b/i.test(label)) {
      target.mortgage_insurance ??= amt;
    } else if (
      /PROPERTY.*TAX|ESTIMATED.*TAX|TAXES/i.test(label) &&
      !/ANNUAL/i.test(label)
    ) {
      target.property_taxes_monthly ??= amt;
    } else if (
      !/\bRENT\b|\bLEASE\b/i.test(label) &&
      (/\bHOME\s*(OWNER)?S?\s*INSURANCE\b/i.test(label) ||
        /\bHAZARD\b/i.test(label) ||
        /\bHOMEOWNERS?\s*INS\b/i.test(label))
    ) {
      target.home_insurance_monthly ??= amt;
    } else if (/\bHOA\b|HOMEOWNER.*ASSOC/i.test(label)) {
      target.hoa_fees_monthly ??= amt;
    } else if (/UTILIT/i.test(label)) {
      if (target.utilities == null) {
        target.utilities =
          amt != null && amt > 0 ? String(amt) : "Not included";
      }
    }
  }
}

function deepScanLineItemArrays(target, obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 20) return;
  if (Array.isArray(obj)) {
    const looksLikeLineItems =
      obj.length > 0 &&
      obj.length <= 25 &&
      obj.every((x) => x && typeof x === "object") &&
      obj.some(
        (x) =>
          parseNumber(x.amount) != null ||
          parseNumber(x.monthlyAmount) != null ||
          paymentLineItemLabel(x).length > 2,
      );
    if (looksLikeLineItems) mergePaymentLineItemsFromArray(target, obj);
    for (const x of obj) deepScanLineItemArrays(target, x, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (
      /lineitem|paymentcomponent|monthlycomponent|housingcost|paymentbreakdown|monthlybreakdown|costbreakdown|estimatedpayment/i.test(
        k,
      ) &&
      Array.isArray(v)
    ) {
      mergePaymentLineItemsFromArray(target, v);
    }
    if (v && typeof v === "object") deepScanLineItemArrays(target, v, depth + 1);
  }
}

function extractPaymentBreakdown(prop, gdpEntry) {
  const out = {
    principal_and_interest: null,
    mortgage_insurance: null,
    property_taxes_monthly: null,
    home_insurance_monthly: null,
    hoa_fees_monthly: null,
    utilities: null,
  };

  const roots = [];
  if (prop) roots.push(prop);
  if (gdpEntry && typeof gdpEntry === "object") {
    roots.push(gdpEntry);
    if (gdpEntry.viewer) roots.push(gdpEntry.viewer);
  }

  const anchorKeys = [
    "mortgageEstimates",
    "mortgageZHL",
    "monthlyPaymentEstimate",
    "affordabilityEstimate",
    "estimatedMonthlyPayment",
    "monthlyPayment",
    "finance",
    "paymentBreakdown",
    "mortgageSection",
    "housingCost",
    "monthlyHousingPayment",
    "paymentCalculator",
    "mortgageCalculator",
    "affordabilityModule",
  ];

  for (const root of roots) {
    if (!root || typeof root !== "object") continue;
    deepScanLineItemArrays(out, root, 0);

    for (const ak of anchorKeys) {
      const sub = root[ak];
      if (!sub || typeof sub !== "object") continue;
      mergePaymentBreakdownNode(out, sub);
      mergePaymentBreakdownNode(out, sub.monthlyPaymentDetails);
      mergePaymentBreakdownNode(out, sub.paymentBreakdown);
      mergePaymentBreakdownNode(out, sub.breakdown);
      mergePaymentBreakdownNode(out, sub.details);
      mergePaymentBreakdownNode(out, sub.defaultScenario);
      mergePaymentBreakdownNode(out, sub.loanScenario);
      mergePaymentBreakdownNode(out, sub.monthlyCosts);
      mergePaymentBreakdownNode(out, sub.scenario);
      mergePaymentBreakdownNode(out, sub.estimate);
    }
  }

  const seen = new WeakSet();
  function walkPaymentNodes(o, depth) {
    if (!o || typeof o !== "object" || depth > 16) return;
    if (seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      for (const x of o) walkPaymentNodes(x, depth + 1);
      return;
    }
    const tn = o.__typename;
    if (
      typeof tn === "string" &&
      /payment|mortgage|housing|afford|monthly|cost/i.test(tn)
    ) {
      mergePaymentBreakdownNode(out, o);
      mergePaymentLineItemsFromArray(out, o.lineItems);
      mergePaymentLineItemsFromArray(out, o.components);
    }
    const keys = Object.keys(o);
    if (keys.length > 100) {
      for (const v of Object.values(o)) walkPaymentNodes(v, depth + 1);
      return;
    }
    const kl = keys.join(" ").toLowerCase();
    if (
      /principalandinterest|principalinterest|propertytax|homeinsurance|mortgageinsurance|hoafees?\b|monthlyhoa|housingpayment|monthlypayment|estimatedpayment|loanpayment/i.test(
        kl,
      )
    ) {
      mergePaymentBreakdownNode(out, o);
      mergePaymentLineItemsFromArray(out, o.lineItems);
      mergePaymentLineItemsFromArray(out, o.components);
    }
    for (const v of Object.values(o)) walkPaymentNodes(v, depth + 1);
  }

  for (const root of roots) walkPaymentNodes(root, 0);

  return out;
}

function mergeDomPaymentBreakdown(out, dom) {
  if (!dom || typeof dom !== "object") return;
  const keys = [
    "principal_and_interest",
    "mortgage_insurance",
    "property_taxes_monthly",
    "home_insurance_monthly",
    "hoa_fees_monthly",
    "utilities",
  ];
  for (const k of keys) {
    if (dom[k] != null && dom[k] !== "") {
      out[k] = dom[k];
    }
  }
}

/** When DOM consensus and JSON disagree slightly, bias toward the lower home-insurance (main row vs “est.”). */
function reconcilePaymentVsJson(pb, jsonPb, rent) {
  const hi = pb.home_insurance_monthly;
  const jhi = jsonPb.home_insurance_monthly;
  if (
    hi != null &&
    jhi != null &&
    hi !== jhi &&
    Math.abs(hi - jhi) > 0 &&
    Math.abs(hi - jhi) <= 28
  ) {
    pb.home_insurance_monthly = Math.min(hi, jhi);
  }

  const pi = pb.principal_and_interest;
  const jpi = jsonPb.principal_and_interest;
  if (
    rent != null &&
    pi != null &&
    jpi != null &&
    pi !== jpi &&
    Math.abs(pi - rent) <= 28 &&
    Math.abs(jpi - rent) > 40
  ) {
    pb.principal_and_interest = jpi;
  }
}

export function extractDetailListing(nextData, listingUrl, domPaymentHint = null) {
  const zpidWanted = extractZpidFromUrl(listingUrl);
  const pageProps = nextData?.props?.pageProps;
  if (!pageProps) return null;

  const rawCache =
    pageProps.gdpClientCache ??
    pageProps.componentProps?.gdpClientCache ??
    deepFindGdpClientCache(pageProps);
  const cache = parseGdpClientCache(rawCache);

  let gdpEntry = null;
  let prop = null;
  if (cache) {
    const row = findGdpCacheRow(cache, zpidWanted);
    gdpEntry = row.entry;
    prop = row.property;
  }

  if (!prop) {
    const alt = pageProps.property ?? pageProps.listing ?? pageProps.home;
    if (alt && typeof alt === "object") prop = alt;
  }

  if (!prop || typeof prop !== "object") return null;

  const addr = addressBlock(prop);
  const zpid = prop.zpid != null ? String(prop.zpid) : zpidWanted;

  const baths =
    parseNumber(prop.bathrooms) ??
    parseNumber(prop.bathroomCount) ??
    parseNumber(prop.resoFacts?.bathrooms) ??
    null;

  const lot =
    parseNumber(prop.lotAreaValue) ??
    parseNumber(prop.resoFacts?.lotSize) ??
    parseNumber(prop.lotSize) ??
    null;

  const hoa =
    parseNumber(prop.monthlyHoaFee) ??
    parseNumber(prop.hoaFee) ??
    parseNumber(prop.resoFacts?.hoaFee) ??
    null;

  let tax = parseNumber(prop.taxAnnualAmount);
  if (tax == null && Array.isArray(prop.taxHistory) && prop.taxHistory.length) {
    const rows = prop.taxHistory
      .filter((x) => x && parseNumber(x.taxPaid) != null)
      .map((x) => ({
        y: Number(x.year ?? x.time ?? x.date) || 0,
        amt: parseNumber(x.taxPaid),
      }))
      .filter((x) => x.amt != null);
    rows.sort((a, b) => b.y - a.y);
    tax = rows[0]?.amt ?? null;
  }

  const days =
    parseNumber(prop.daysOnZillow) ??
    parseNumber(prop.timeOnZillow?.days) ??
    parseNumber(prop.attributionInfo?.timeOnZillow) ??
    null;

  return {
    listing_id: zpid ?? null,
    address: addr.address,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
    price:
      parseNumber(prop.price) ??
      parseNumber(prop.unformattedPrice) ??
      parseNumber(prop.listingPrice) ??
      null,
    beds:
      parseNumber(prop.bedrooms) ??
      parseNumber(prop.bedroomCount) ??
      parseNumber(prop.resoFacts?.bedrooms) ??
      null,
    baths,
    sqft:
      parseNumber(prop.livingArea) ??
      parseNumber(prop.livingAreaValue) ??
      parseNumber(prop.area) ??
      parseNumber(prop.resoFacts?.livingArea) ??
      null,
    year_built:
      parseNumber(prop.yearBuilt) ??
      parseNumber(prop.resoFacts?.yearBuilt) ??
      null,
    property_type:
      prop.homeType ??
      prop.propertyTypeDimension ??
      prop.resoFacts?.homeType ??
      null,
    status: statusLabel(prop.homeStatus ?? prop.listingStatus),
    zestimate: pickZestimate(prop),
    rent_estimate: pickRentEstimate(prop),
    hoa_monthly: hoa,
    tax_annual: tax,
    lot_size: lot,
    days_on_zillow: days,
    listing_url: normalizeZillowUrl(listingUrl),
    payment_breakdown: (() => {
      const fromJson = extractPaymentBreakdown(prop, gdpEntry);
      const pb = { ...fromJson };
      mergeDomPaymentBreakdown(pb, domPaymentHint);
      reconcilePaymentVsJson(pb, fromJson, pickRentEstimate(prop));
      if (pb.hoa_fees_monthly == null) {
        const h =
          parseNumber(prop.monthlyHoaFee) ??
          parseNumber(prop.hoaFee) ??
          parseNumber(prop.resoFacts?.hoaFee);
        if (h != null) pb.hoa_fees_monthly = h;
      }
      return pb;
    })(),
  };
}
