/**
 * Analytics Enricher — merges Google Search Console and GA4 data into crawled page results.
 *
 * Designed to slot between Phase 1 (crawl) and Phase 4 (LLM analysis) of the SEO auditor.
 * All analytics fetching is optional and fails gracefully — if credentials are missing or
 * an API call fails, page results are returned unmodified.
 *
 * Usage in seo-auditor.js (after Phase 1):
 *   import { enrichWithAnalytics, formatAnalyticsForPrompt } from '../tools/analytics-enricher.js';
 *   const enrichedPages = await enrichWithAnalytics(pageResults, config, log);
 *   // then pass enrichedPages to PAGE_ANALYSIS_PROMPT, calling formatAnalyticsForPrompt(page.analytics)
 */

import { fetchSearchConsoleData } from './google-search-console.js';
import { fetchGA4Data } from './google-analytics.js';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Queries at positions 8–20 are "low-hanging fruit": they appear on page 1 or
 * early page 2 and can reach position 1–7 with targeted optimisation.
 */
const LOW_HANGING_FRUIT_MIN_POSITION = 8;
const LOW_HANGING_FRUIT_MAX_POSITION = 20;

/**
 * Approximate expected CTR by average SERP position (based on industry studies).
 * Used to compute ctrGap = expectedCtr - actualCtr.
 * Keyed by integer position (1-indexed). Positions beyond 10 share the same rough curve.
 */
const EXPECTED_CTR_BY_POSITION = {
  1: 0.284,
  2: 0.146,
  3: 0.096,
  4: 0.073,
  5: 0.057,
  6: 0.043,
  7: 0.037,
  8: 0.030,
  9: 0.026,
  10: 0.022,
  11: 0.018,
  12: 0.015,
  13: 0.013,
  14: 0.011,
  15: 0.010,
  16: 0.009,
  17: 0.008,
  18: 0.007,
  19: 0.007,
  20: 0.006,
};

// ── URL normalisation ────────────────────────────────────────────────────────

/**
 * Extract the path portion of a URL for matching against GSC/GA4 rows, which
 * typically return paths rather than full URLs.
 *
 * Examples:
 *   "https://example.com/features"  → "/features"
 *   "https://example.com/"          → "/"
 *   "/features"                     → "/features"
 *
 * @param {string} rawUrl - Full URL or path string.
 * @returns {string} Normalised path with leading slash, no trailing slash (except root).
 */
function normalisePath(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname.replace(/\/$/, '') || '/';
    return path;
  } catch {
    // rawUrl is already a path
    const path = rawUrl.replace(/\/$/, '') || '/';
    return path.startsWith('/') ? path : `/${path}`;
  }
}

/**
 * Build a lookup map from normalised path → analytics row for fast O(1) matching.
 *
 * @template T
 * @param {T[]} rows - Array of objects that each have a `url` or `pagePath` property.
 * @param {string} keyProp - Property name that holds the URL/path value.
 * @returns {Map<string, T>}
 */
function buildPathMap(rows, keyProp) {
  const map = new Map();
  for (const row of rows) {
    const raw = row[keyProp];
    if (raw) {
      map.set(normalisePath(raw), row);
    }
  }
  return map;
}

// ── GSC data shaping ─────────────────────────────────────────────────────────

/**
 * Determine the expected CTR for a given average SERP position.
 * Positions beyond 20 return a conservative 0.005.
 *
 * @param {number} position - Average SERP position (e.g. 8.3 rounds to 8).
 * @returns {number} Expected CTR as a decimal (e.g. 0.030).
 */
function expectedCtrForPosition(position) {
  const rounded = Math.min(20, Math.max(1, Math.round(position)));
  return EXPECTED_CTR_BY_POSITION[rounded] ?? 0.005;
}

/**
 * Shape raw GSC page-level and query-level data into the structured `gsc` analytics
 * object attached to each enriched page result.
 *
 * @param {object} pageRow - GSC row for the page: { url, impressions, clicks, ctr, avgPosition }.
 * @param {object[]} queryRows - GSC query rows for this page: [{ query, impressions, clicks, ctr, position }, ...].
 * @returns {object} Shaped GSC analytics object.
 */
function shapeGSCPage(pageRow, queryRows) {
  const { impressions = 0, clicks = 0, ctr = 0, avgPosition = 0 } = pageRow;

  // Top queries: all queries sorted by impressions descending, capped at 10.
  const topQueries = [...queryRows]
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, 10)
    .map(q => ({
      query: q.query,
      impressions: q.impressions ?? 0,
      clicks: q.clicks ?? 0,
      ctr: typeof q.ctr === 'number' ? Number(q.ctr.toFixed(4)) : 0,
      position: typeof q.position === 'number' ? Number(q.position.toFixed(1)) : 0,
    }));

  // Low-hanging fruit: queries in positions 8–20 with meaningful impression volume.
  const lowHangingFruit = queryRows
    .filter(q => {
      const pos = q.position ?? 0;
      return pos >= LOW_HANGING_FRUIT_MIN_POSITION && pos <= LOW_HANGING_FRUIT_MAX_POSITION;
    })
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, 5)
    .map(q => {
      const expectedCtr = expectedCtrForPosition(q.position);
      return {
        query: q.query,
        impressions: q.impressions ?? 0,
        position: typeof q.position === 'number' ? Number(q.position.toFixed(1)) : 0,
        ctr: typeof q.ctr === 'number' ? Number(q.ctr.toFixed(4)) : 0,
        expectedCtr: Number(expectedCtr.toFixed(4)),
      };
    });

  // ctrGap: positive = page underperforms vs expected; negative = overperforms.
  const expectedCtr = expectedCtrForPosition(avgPosition);
  const ctrGap = Number((expectedCtr - ctr).toFixed(4));

  return {
    impressions,
    clicks,
    ctr: Number(ctr.toFixed(4)),
    avgPosition: typeof avgPosition === 'number' ? Number(avgPosition.toFixed(1)) : 0,
    topQueries,
    lowHangingFruit,
    ctrGap,
  };
}

// ── GA4 data shaping ─────────────────────────────────────────────────────────

/**
 * Shape a raw GA4 page row into the structured `ga4` analytics object.
 *
 * @param {object} pageRow - GA4 row: { pagePath, pageViews, uniqueUsers, avgSessionDuration,
 *                            bounceRate, organicTraffic, trafficSources }.
 * @returns {object} Shaped GA4 analytics object.
 */
function shapeGA4Page(pageRow) {
  const {
    pageViews = 0,
    uniqueUsers = 0,
    avgSessionDuration = 0,
    bounceRate = 0,
    organicTraffic = 0,
    trafficSources = {},
  } = pageRow;

  return {
    pageViews,
    uniqueUsers,
    avgSessionDuration: typeof avgSessionDuration === 'number'
      ? Number(avgSessionDuration.toFixed(1))
      : 0,
    bounceRate: typeof bounceRate === 'number' ? Number(bounceRate.toFixed(4)) : 0,
    organicTraffic,
    trafficSources: {
      organic: trafficSources.organic ?? organicTraffic,
      direct: trafficSources.direct ?? 0,
      referral: trafficSources.referral ?? 0,
      social: trafficSources.social ?? 0,
    },
  };
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Enrich an array of crawled page results with Google Search Console and/or
 * Google Analytics 4 data.
 *
 * Each page result that can be matched to an analytics row will have an
 * `analytics` property added with the shape:
 * ```
 * {
 *   gsc: { impressions, clicks, ctr, avgPosition, topQueries, lowHangingFruit, ctrGap },
 *   ga4: { pageViews, uniqueUsers, avgSessionDuration, bounceRate, organicTraffic, trafficSources }
 * }
 * ```
 *
 * Pages with no matching analytics data receive `analytics: { gsc: null, ga4: null }`.
 * Pages are never removed from the results array; the function is purely additive.
 *
 * If neither GSC nor GA4 is configured in `config.sites[0].analytics`, the original
 * `pageResults` array is returned unchanged (no mutation, no error thrown).
 *
 * @param {object[]} pageResults - Crawled page objects from seo-auditor Phase 1.
 *   Each has at minimum: { url: string, meta: object, ... }
 * @param {object} config - Brad config loaded from `.brad/config.json`.
 *   Expected shape: { sites: [{ analytics: { gsc_property?: string, ga4_prod?: string } }] }
 * @param {function(string): void} log - Logging callback (receives a plain string).
 * @returns {Promise<object[]>} The same page results array, each page optionally
 *   augmented with an `analytics` property.
 */
export async function enrichWithAnalytics(pageResults, config, log) {
  const noop = () => {};
  const _log = typeof log === 'function' ? log : noop;

  // Extract analytics config from the first configured site.
  const analyticsConfig = config?.sites?.[0]?.analytics ?? {};
  const gscProperty = analyticsConfig.gsc_site_url ?? analyticsConfig.gsc_property ?? analyticsConfig.gsc ?? process.env.GSC_SITE_URL ?? null;
  const ga4PropertyId = analyticsConfig.ga4_property_id ?? process.env.GA4_PROPERTY_ID ?? null;

  const hasGSC = Boolean(gscProperty);
  const hasGA4 = Boolean(ga4PropertyId);

  // Nothing configured — return results untouched.
  if (!hasGSC && !hasGA4) {
    return pageResults;
  }

  // ── Fetch both sources in parallel ────────────────────────────────────────

  /** @type {object[]|null} */
  let gscPages = null;
  /** @type {Map<string, object[]>|null} */
  let gscQueriesByPath = null;
  /** @type {object[]|null} */
  let ga4Pages = null;

  const fetchPromises = [];

  if (hasGSC) {
    _log('Fetching GSC data...');
    fetchPromises.push(
      fetchSearchConsoleData(gscProperty, { credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS })
        .then(result => {
          gscPages = result?.perPageMetrics ?? [];
          // result.lowHangingFruit has query-level data we can use for per-page lookup
          gscQueriesByPath = new Map();
          for (const row of result?.lowHangingFruit ?? []) {
            const path = normalisePath(row.page ?? row.pagePath ?? row.url ?? '');
            if (!gscQueriesByPath.has(path)) {
              gscQueriesByPath.set(path, []);
            }
            gscQueriesByPath.get(path).push(row);
          }
          _log(`  GSC: received ${gscPages.length} page rows`);
        })
        .catch(err => {
          _log(`  GSC fetch failed (continuing without): ${err.message}`);
          gscPages = null;
          gscQueriesByPath = null;
        })
    );
  }

  if (hasGA4) {
    _log('Fetching GA4 data...');
    fetchPromises.push(
      fetchGA4Data(ga4PropertyId, { credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS })
        .then(result => {
          ga4Pages = result?.perPageMetrics ?? [];
          _log(`  GA4: received ${ga4Pages.length} page rows`);
        })
        .catch(err => {
          _log(`  GA4 fetch failed (continuing without): ${err.message}`);
          ga4Pages = null;
        })
    );
  }

  await Promise.all(fetchPromises);

  // ── Build path lookup maps ─────────────────────────────────────────────────

  /** @type {Map<string, object>} */
  const gscPageMap = gscPages ? buildPathMap(gscPages, 'url') : new Map();
  /** @type {Map<string, object>} */
  const ga4PageMap = ga4Pages ? buildPathMap(ga4Pages, 'pagePath') : new Map();

  // ── Match and attach analytics to each page ────────────────────────────────

  let enrichedCount = 0;

  // Determine if the site uses a path prefix (e.g., /lana-ai/) on the production server.
  // GA4 tracks the real server path, not the vanity domain path.
  const siteConfig = config?.sites?.[0] ?? {};
  const productionUrl = siteConfig.production || '';
  let pathPrefix = '';
  if (productionUrl) {
    try {
      const prodPath = new URL(productionUrl).pathname.replace(/\/$/, '');
      if (prodPath && prodPath !== '/') pathPrefix = prodPath;
    } catch { /* ignore */ }
  }
  if (pathPrefix) {
    _log(`  Path prefix detected: ${pathPrefix} (GA4 paths will be matched with this prefix)`);
  }

  const enriched = pageResults.map(page => {
    // Pages that errored during crawl pass through untouched.
    if (page.error) {
      return page;
    }

    const path = normalisePath(page.url);
    // Try both: exact path AND prefixed path (for domain rewrites like lanaai.io → /lana-ai/*)
    const prefixedPath = pathPrefix ? `${pathPrefix}${path === '/' ? '' : path}` || pathPrefix : null;

    const gscRow = gscPageMap.get(path) ?? (prefixedPath ? gscPageMap.get(prefixedPath) : null);
    const ga4Row = ga4PageMap.get(path) ?? (prefixedPath ? ga4PageMap.get(prefixedPath) : null);

    // Only attach the analytics property when at least one source is available.
    if (!gscRow && !ga4Row) {
      return { ...page, analytics: { gsc: null, ga4: null } };
    }

    const analytics = {
      gsc: gscRow
        ? shapeGSCPage(gscRow, gscQueriesByPath?.get(path) ?? [])
        : null,
      ga4: ga4Row
        ? shapeGA4Page(ga4Row)
        : null,
    };

    enrichedCount++;
    return { ...page, analytics };
  });

  _log(`Enriched ${enrichedCount} pages with analytics`);

  return enriched;
}

// ── Prompt formatting ────────────────────────────────────────────────────────

/**
 * Format a page's analytics object into a markdown string for injection into
 * the per-page LLM analysis prompt.
 *
 * Designed to be concise yet information-dense. The LLM uses this section to:
 * - Identify which queries are driving impressions vs clicks (CTR opportunities)
 * - Flag low-hanging fruit queries where a small ranking improvement yields large gains
 * - Cross-reference organic traffic share against bounce rate to spot UX issues
 * - Understand overall traffic composition
 *
 * Returns an empty string when `pageAnalytics` is null/undefined or when both
 * `gsc` and `ga4` sub-objects are null, so callers can safely interpolate without
 * a conditional check.
 *
 * @param {object|null|undefined} pageAnalytics - The `analytics` property from an enriched
 *   page result, or null/undefined if the page was not enriched.
 * @returns {string} Markdown section ready for prompt injection. Empty string if no data.
 */
export function formatAnalyticsForPrompt(pageAnalytics) {
  if (!pageAnalytics) return '';

  const { gsc, ga4 } = pageAnalytics;

  if (!gsc && !ga4) return '';

  const lines = ['## Analytics Data (last 90 days)'];

  // ── GSC block ─────────────────────────────────────────────────────────────
  if (gsc) {
    lines.push('### Search Console');

    const ctrPct = (gsc.ctr * 100).toFixed(2);
    const ctrGapPct = (Math.abs(gsc.ctrGap) * 100).toFixed(2);
    const ctrGapDir = gsc.ctrGap > 0 ? `underperforms by ${ctrGapPct}%` : `overperforms by ${ctrGapPct}%`;

    lines.push(
      `- Impressions: ${gsc.impressions.toLocaleString()} | ` +
      `Clicks: ${gsc.clicks.toLocaleString()} | ` +
      `CTR: ${ctrPct}% | ` +
      `Avg Position: ${gsc.avgPosition}`
    );
    lines.push(`- CTR vs expected: ${ctrGapDir} (expected ~${((gsc.avgPosition <= 20 ? EXPECTED_CTR_BY_POSITION[Math.round(gsc.avgPosition)] ?? 0.005 : 0.005) * 100).toFixed(2)}% at position ${gsc.avgPosition})`);

    if (gsc.topQueries.length > 0) {
      lines.push('- Top queries (by impressions):');
      for (const q of gsc.topQueries) {
        const qCtrPct = (q.ctr * 100).toFixed(2);
        lines.push(
          `  - "${q.query}" — ${q.impressions.toLocaleString()} impr, ` +
          `${q.clicks} clicks, CTR ${qCtrPct}%, pos ${q.position}`
        );
      }
    } else {
      lines.push('- Top queries: none recorded');
    }

    if (gsc.lowHangingFruit.length > 0) {
      lines.push('- Low-hanging fruit (positions 8–20, optimise to reach page 1):');
      for (const q of gsc.lowHangingFruit) {
        const actualCtrPct = (q.ctr * 100).toFixed(2);
        const expectedCtrPct = (q.expectedCtr * 100).toFixed(2);
        lines.push(
          `  - "${q.query}" — pos ${q.position}, ` +
          `${q.impressions.toLocaleString()} impr, ` +
          `actual CTR ${actualCtrPct}% vs expected ${expectedCtrPct}%`
        );
      }
    } else {
      lines.push('- Low-hanging fruit: none in positions 8–20');
    }
  }

  // ── GA4 block ─────────────────────────────────────────────────────────────
  if (ga4) {
    lines.push('### Google Analytics');

    const bounceRatePct = (ga4.bounceRate * 100).toFixed(0);
    const avgSessionSec = Math.round(ga4.avgSessionDuration);

    lines.push(
      `- Page views: ${ga4.pageViews.toLocaleString()} | ` +
      `Unique users: ${ga4.uniqueUsers.toLocaleString()}`
    );
    lines.push(
      `- Bounce rate: ${bounceRatePct}% | ` +
      `Avg session: ${avgSessionSec}s`
    );

    const { organic, direct, referral, social } = ga4.trafficSources;
    lines.push(
      `- Traffic: ${organic.toLocaleString()} organic, ` +
      `${direct.toLocaleString()} direct, ` +
      `${referral.toLocaleString()} referral, ` +
      `${social.toLocaleString()} social`
    );
  }

  return lines.join('\n');
}
