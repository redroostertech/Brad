/**
 * Google Search Console API Client
 *
 * Fetches search analytics data for SEO auditing.
 * Authenticates via a Google service account JSON key file.
 *
 * Required setup:
 *   1. Create a Google Cloud service account with Search Console access.
 *   2. Download the JSON key file.
 *   3. Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json in your environment,
 *      or pass `credentialsPath` in options.
 *   4. In Google Search Console, add the service account email as a "Restricted"
 *      or "Full" user on the property you want to query.
 *
 * NOTE: The `googleapis` package must be installed:
 *   npm install googleapis
 */

import { google } from 'googleapis';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

// ---------------------------------------------------------------------------
// CTR benchmarks by average position (industry averages, rounded)
// ---------------------------------------------------------------------------

/**
 * Expected CTR values indexed by integer position (1–10).
 * Positions 11+ are treated as position 10 (roughly 2%).
 * Used to flag pages where actual CTR falls significantly below expectation.
 *
 * @type {Record<number, number>}
 */
const EXPECTED_CTR_BY_POSITION = {
  1: 0.28,
  2: 0.15,
  3: 0.11,
  4: 0.08,
  5: 0.06,
  6: 0.045,
  7: 0.035,
  8: 0.03,
  9: 0.025,
  10: 0.02,
};

/**
 * Returns the expected CTR for a given average position.
 * Clamps to position 1 (floor) and position 10 (ceiling).
 *
 * @param {number} position - Average position (may be fractional, e.g. 3.7)
 * @returns {number} Expected CTR as a decimal (e.g. 0.11 = 11%)
 */
function expectedCtrForPosition(position) {
  const rounded = Math.max(1, Math.min(10, Math.round(position)));
  return EXPECTED_CTR_BY_POSITION[rounded] ?? 0.02;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Resolves the path to the Google service account credentials file.
 * Checks the supplied path first, then GOOGLE_APPLICATION_CREDENTIALS.
 *
 * @param {string|undefined} credentialsPath - Explicit path override from options
 * @returns {string|null} Resolved file path, or null if not found
 */
function resolveCredentialsPath(credentialsPath) {
  if (credentialsPath && existsSync(credentialsPath)) {
    return credentialsPath;
  }
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }
  return null;
}

/**
 * Creates an authenticated Google API auth client from a service account key.
 *
 * @param {string} credentialsPath - Path to the service account JSON key file
 * @returns {Promise<import('googleapis').Auth.GoogleAuth>} Authenticated auth client
 */
async function createAuthClient(credentialsPath) {
  const raw = await readFile(credentialsPath, 'utf-8');
  const keyFile = JSON.parse(raw);

  const auth = new google.auth.GoogleAuth({
    credentials: keyFile,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });

  return auth;
}

// ---------------------------------------------------------------------------
// GSC API helpers
// ---------------------------------------------------------------------------

/**
 * Builds the ISO date string for N days ago from today.
 *
 * @param {number} daysAgo
 * @returns {string} YYYY-MM-DD
 */
function daysAgoDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * Executes a single Search Analytics query against the GSC API.
 * Handles the common request envelope so callers only specify dimensions and filters.
 *
 * @param {import('googleapis').searchconsole_v1.Searchconsole} sc - Authenticated SC client
 * @param {string} siteUrl - The verified property URL (e.g. "https://example.com/")
 * @param {string[]} dimensions - Dimensions to group by (e.g. ['query', 'page'])
 * @param {number} rowLimit - Max rows to return (GSC max is 25000)
 * @param {object} [extra={}] - Additional request body fields (e.g. dimensionFilterGroups)
 * @returns {Promise<Array>} Rows array from the API response
 */
async function querySearchAnalytics(sc, siteUrl, dimensions, rowLimit, extra = {}) {
  const response = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: daysAgoDate(90),
      endDate: daysAgoDate(1),
      dimensions,
      rowLimit,
      ...extra,
    },
  });
  return response.data.rows ?? [];
}

// ---------------------------------------------------------------------------
// Data builders
// ---------------------------------------------------------------------------

/**
 * Fetches per-page metrics: impressions, clicks, CTR, average position.
 * Also fetches the top queries per page in a second call grouped by page+query,
 * then attaches the top 5 queries to each page record.
 *
 * @param {import('googleapis').searchconsole_v1.Searchconsole} sc
 * @param {string} siteUrl
 * @returns {Promise<Array<PageMetrics>>}
 *
 * @typedef {object} PageMetrics
 * @property {string} url
 * @property {number} impressions
 * @property {number} clicks
 * @property {number} ctr - Decimal (e.g. 0.034)
 * @property {number} position - Average position
 * @property {Array<{query: string, impressions: number, clicks: number, ctr: number, position: number}>} topQueries
 */
async function buildPerPageMetrics(sc, siteUrl) {
  // Page-level rollup
  const pageRows = await querySearchAnalytics(sc, siteUrl, ['page'], 5000);

  // Page+query breakdown for top-query attribution
  const pageQueryRows = await querySearchAnalytics(sc, siteUrl, ['page', 'query'], 25000);

  // Index page+query rows by page URL
  /** @type {Map<string, Array>} */
  const queryByPage = new Map();
  for (const row of pageQueryRows) {
    const [pageUrl, query] = row.keys;
    if (!queryByPage.has(pageUrl)) {
      queryByPage.set(pageUrl, []);
    }
    queryByPage.get(pageUrl).push({
      query,
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    });
  }

  // Sort each page's queries by impressions descending, keep top 5
  return pageRows.map((row) => {
    const [url] = row.keys;
    const queries = (queryByPage.get(url) ?? [])
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 5);

    return {
      url,
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
      topQueries: queries,
    };
  });
}

/**
 * Identifies low-hanging-fruit keywords: queries ranking in positions 8–20
 * (page 2 territory, close to page 1 visibility).
 *
 * @param {import('googleapis').searchconsole_v1.Searchconsole} sc
 * @param {string} siteUrl
 * @returns {Promise<Array<LowHangingFruit>>}
 *
 * @typedef {object} LowHangingFruit
 * @property {string} query
 * @property {string} page
 * @property {number} impressions
 * @property {number} clicks
 * @property {number} ctr
 * @property {number} position
 */
async function buildLowHangingFruit(sc, siteUrl) {
  const rows = await querySearchAnalytics(sc, siteUrl, ['query', 'page'], 25000, {
    dimensionFilterGroups: [
      {
        filters: [
          {
            dimension: 'position',
            operator: 'greaterThanEquals',
            expression: '8',
          },
          {
            dimension: 'position',
            operator: 'lessThanEquals',
            expression: '20',
          },
        ],
      },
    ],
  });

  return rows
    .filter((row) => {
      const pos = row.position ?? 0;
      return pos >= 8 && pos <= 20;
    })
    .map((row) => {
      const [query, page] = row.keys;
      return {
        query,
        page,
        impressions: row.impressions ?? 0,
        clicks: row.clicks ?? 0,
        ctr: row.ctr ?? 0,
        position: row.position ?? 0,
      };
    })
    .sort((a, b) => b.impressions - a.impressions);
}

/**
 * Identifies CTR gaps: query+page combinations where impressions are
 * meaningful (>= minImpressions) but actual CTR is less than
 * ctrGapThreshold * expectedCtr for that position.
 *
 * The gap amount indicates how far below expected the actual CTR is.
 *
 * @param {import('googleapis').searchconsole_v1.Searchconsole} sc
 * @param {string} siteUrl
 * @param {number} minImpressions - Minimum impressions to be included (default 100)
 * @param {number} ctrGapThreshold - CTR must be below this fraction of expected (default 0.7)
 * @returns {Promise<Array<CtrGap>>}
 *
 * @typedef {object} CtrGap
 * @property {string} query
 * @property {string} page
 * @property {number} impressions
 * @property {number} clicks
 * @property {number} ctr - Actual CTR (decimal)
 * @property {number} position
 * @property {number} expectedCtr - Benchmark CTR for this position (decimal)
 * @property {number} ctrGap - How far below expected (decimal, always positive)
 */
async function buildCtrGaps(sc, siteUrl, minImpressions = 100, ctrGapThreshold = 0.7) {
  const rows = await querySearchAnalytics(sc, siteUrl, ['query', 'page'], 25000);

  const gaps = [];

  for (const row of rows) {
    const impressions = row.impressions ?? 0;
    if (impressions < minImpressions) continue;

    const [query, page] = row.keys;
    const position = row.position ?? 0;
    const actualCtr = row.ctr ?? 0;
    const expected = expectedCtrForPosition(position);

    // Flag if actual CTR is below the threshold fraction of expected
    if (actualCtr < expected * ctrGapThreshold) {
      gaps.push({
        query,
        page,
        impressions,
        clicks: row.clicks ?? 0,
        ctr: actualCtr,
        position,
        expectedCtr: expected,
        ctrGap: expected - actualCtr,
      });
    }
  }

  // Sort by lost opportunity: impressions * gap size
  return gaps.sort((a, b) => b.impressions * b.ctrGap - a.impressions * a.ctrGap);
}

/**
 * Fetches top 50 keywords by impressions across the whole property.
 *
 * @param {import('googleapis').searchconsole_v1.Searchconsole} sc
 * @param {string} siteUrl
 * @returns {Promise<Array<TopKeyword>>}
 *
 * @typedef {object} TopKeyword
 * @property {string} query
 * @property {number} impressions
 * @property {number} clicks
 * @property {number} ctr
 * @property {number} position
 */
async function buildTopKeywords(sc, siteUrl) {
  const rows = await querySearchAnalytics(sc, siteUrl, ['query'], 50);

  return rows.map((row) => {
    const [query] = row.keys;
    return {
      query,
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether Google Search Console credentials are available and readable.
 * Does NOT validate that the credentials are actually authorized on any property.
 *
 * @param {string} [credentialsPath] - Optional explicit path to service account JSON
 * @returns {boolean}
 */
export function isGSCConfigured(credentialsPath) {
  return resolveCredentialsPath(credentialsPath) !== null;
}

/**
 * Fetches comprehensive search analytics data from Google Search Console
 * for the given site URL over the last 90 days.
 *
 * Returns null (without throwing) if GSC is not configured or if the API
 * call fails — allowing callers to degrade gracefully.
 *
 * @param {string} siteUrl - The verified GSC property URL.
 *   Must match exactly how the property is registered in Search Console.
 *   Examples:
 *     "https://example.com/"         (URL-prefix property)
 *     "sc-domain:example.com"         (Domain property)
 *
 * @param {FetchOptions} [options={}]
 *
 * @typedef {object} FetchOptions
 * @property {string}  [credentialsPath]   - Path to service account JSON key file.
 *                                           Falls back to GOOGLE_APPLICATION_CREDENTIALS env var.
 * @property {number}  [minImpressions=100] - Minimum impressions threshold for CTR gap detection.
 * @property {number}  [ctrGapThreshold=0.7] - CTR gap sensitivity (0–1). Lower = more gaps reported.
 *                                            0.7 means "flag if actual CTR < 70% of expected".
 *
 * @returns {Promise<SearchConsoleData|null>}
 *
 * @typedef {object} SearchConsoleData
 * @property {string}   siteUrl         - The queried property URL
 * @property {string}   dateRange       - Human-readable date range label
 * @property {string}   startDate       - ISO date (YYYY-MM-DD)
 * @property {string}   endDate         - ISO date (YYYY-MM-DD)
 * @property {object}   benchmarks      - CTR benchmarks table (positions 1–10)
 * @property {Array}    perPageMetrics  - Per-page impressions, clicks, CTR, position, top queries
 * @property {Array}    lowHangingFruit - Queries on positions 8–20 sorted by impressions
 * @property {Array}    ctrGaps         - High-impression, below-expected-CTR opportunities
 * @property {Array}    topKeywords     - Top 50 queries by impressions
 */
export async function fetchSearchConsoleData(siteUrl, options = {}) {
  const {
    credentialsPath: credentialsPathOption,
    minImpressions = 100,
    ctrGapThreshold = 0.7,
  } = options;

  // Resolve credentials — return null gracefully if missing
  const resolvedCredentialsPath = resolveCredentialsPath(credentialsPathOption);
  if (!resolvedCredentialsPath) {
    // Not configured — not an error, just unavailable
    return null;
  }

  let sc;

  try {
    const auth = await createAuthClient(resolvedCredentialsPath);
    sc = google.searchconsole({ version: 'v1', auth });
  } catch (err) {
    console.warn(`[gsc] Failed to initialize Search Console client: ${err.message}`);
    return null;
  }

  try {
    // Run all four queries in parallel for speed
    const [perPageMetrics, lowHangingFruit, ctrGaps, topKeywords] = await Promise.all([
      buildPerPageMetrics(sc, siteUrl),
      buildLowHangingFruit(sc, siteUrl),
      buildCtrGaps(sc, siteUrl, minImpressions, ctrGapThreshold),
      buildTopKeywords(sc, siteUrl),
    ]);

    return {
      siteUrl,
      dateRange: 'Last 90 days',
      startDate: daysAgoDate(90),
      endDate: daysAgoDate(1),
      benchmarks: {
        description: 'Expected CTR by average position (industry averages)',
        positions: EXPECTED_CTR_BY_POSITION,
      },
      perPageMetrics,
      lowHangingFruit,
      ctrGaps,
      topKeywords,
    };
  } catch (err) {
    console.warn(`[gsc] Search Console API error for ${siteUrl}: ${err.message}`);
    return null;
  }
}
