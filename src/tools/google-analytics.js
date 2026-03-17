/**
 * Google Analytics 4 Data API Client
 *
 * Fetches per-page traffic metrics, traffic source breakdowns, and
 * engagement signals from the GA4 Data API for SEO auditing.
 *
 * SETUP REQUIRED:
 *   npm install @google-analytics/data
 *
 * AUTHENTICATION:
 *   Uses a Google Cloud service account JSON key file.
 *   Grant the service account "Viewer" access on your GA4 property.
 *
 *   Set credentials via environment variable:
 *     export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
 *
 *   Or pass the path in config:
 *     { ga4: { credentialsPath: '/path/to/service-account.json' } }
 *
 * PROPERTY ID NOTE:
 *   The GA4 Data API requires the *numeric* property ID, not the
 *   measurement ID (G-XXXXXXX) shown in the GA4 UI.
 *
 *   To find your numeric property ID:
 *     GA4 → Admin → Property Settings → Property ID (top right, e.g. 123456789)
 *
 *   You can pass either format to fetchGA4Data() — if a measurement ID
 *   like "G-7G2ZLJLFF1" is detected, a clear error will guide you to
 *   the correct numeric ID.
 */

// ---------------------------------------------------------------------------
// Lazy loader — avoids hard crashing if the package is not installed
// ---------------------------------------------------------------------------

/** @type {import('@google-analytics/data').BetaAnalyticsDataClient | null} */
let BetaAnalyticsDataClient = null;

/**
 * Attempt to load the @google-analytics/data package.
 * Returns true if the package is available, false otherwise.
 *
 * @returns {Promise<boolean>}
 */
async function loadGA4Package() {
  if (BetaAnalyticsDataClient !== null) return true;

  try {
    const mod = await import('@google-analytics/data');
    BetaAnalyticsDataClient = mod.BetaAnalyticsDataClient;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the date range string used in all GA4 API requests.
 * GA4 uses "NdaysAgo" format for relative ranges.
 *
 * @param {number} days - Number of days to look back (default 90)
 * @returns {{ startDate: string, endDate: string }}
 */
function buildDateRange(days = 90) {
  return {
    startDate: `${days}daysAgo`,
    endDate: 'today',
  };
}

/**
 * Extract a named dimension value from a GA4 row.
 *
 * @param {object} row - GA4 RunReportResponse row
 * @param {string[]} dimensionNames - Ordered list of dimension names from the request
 * @param {string} name - Dimension name to extract
 * @returns {string}
 */
function getDimension(row, dimensionNames, name) {
  const idx = dimensionNames.indexOf(name);
  return idx !== -1 ? (row.dimensionValues?.[idx]?.value ?? '') : '';
}

/**
 * Extract a named metric value from a GA4 row (returns a float).
 *
 * @param {object} row - GA4 RunReportResponse row
 * @param {string[]} metricNames - Ordered list of metric names from the request
 * @param {string} name - Metric name to extract
 * @returns {number}
 */
function getMetric(row, metricNames, name) {
  const idx = metricNames.indexOf(name);
  return idx !== -1 ? parseFloat(row.metricValues?.[idx]?.value ?? '0') : 0;
}

/**
 * Round a float to 2 decimal places for clean JSON output.
 *
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// GA4 API request helpers
// ---------------------------------------------------------------------------

/**
 * Run a GA4 report request and return the response rows.
 *
 * @param {object} client - BetaAnalyticsDataClient instance
 * @param {string} propertyId - Numeric property ID (without "properties/" prefix)
 * @param {object} requestBody - GA4 RunReportRequest body fields
 * @returns {Promise<object[]>} Array of row objects from the response
 */
async function runReport(client, propertyId, requestBody) {
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    ...requestBody,
  });
  return response.rows ?? [];
}

// ---------------------------------------------------------------------------
// Data fetchers — each fetches one logical dataset
// ---------------------------------------------------------------------------

/**
 * Fetch per-page metrics: page views, unique users, avg session duration,
 * bounce rate, entrances, and exits for each page path.
 *
 * @param {object} client - BetaAnalyticsDataClient instance
 * @param {string} propertyId - Numeric GA4 property ID
 * @param {{ startDate: string, endDate: string }} dateRange
 * @returns {Promise<object[]>} Array of per-page metric objects
 */
async function fetchPerPageMetrics(client, propertyId, dateRange) {
  const dimensions = ['pagePath'];
  const metrics = [
    'screenPageViews',
    'totalUsers',
    'averageSessionDuration',
    'bounceRate',
    'sessions',
    'engagedSessions',
  ];

  const rows = await runReport(client, propertyId, {
    dateRanges: [dateRange],
    dimensions: dimensions.map(name => ({ name })),
    metrics: metrics.map(name => ({ name })),
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 200,
  });

  return rows.map(row => ({
    pagePath: getDimension(row, dimensions, 'pagePath'),
    pageViews: Math.round(getMetric(row, metrics, 'screenPageViews')),
    uniqueUsers: Math.round(getMetric(row, metrics, 'totalUsers')),
    avgSessionDurationSec: round2(getMetric(row, metrics, 'averageSessionDuration')),
    bounceRate: round2(getMetric(row, metrics, 'bounceRate')),
    sessions: Math.round(getMetric(row, metrics, 'sessions')),
    engagedSessions: Math.round(getMetric(row, metrics, 'engagedSessions')),
  }));
}

/**
 * Fetch traffic source breakdown per page path.
 * Channels: Organic Search, Direct, Referral, Organic Social.
 *
 * @param {object} client - BetaAnalyticsDataClient instance
 * @param {string} propertyId - Numeric GA4 property ID
 * @param {{ startDate: string, endDate: string }} dateRange
 * @returns {Promise<object[]>} Array of { pagePath, channel, sessions } objects
 */
async function fetchTrafficSourcesPerPage(client, propertyId, dateRange) {
  const dimensions = ['pagePath', 'sessionDefaultChannelGroup'];
  const metrics = ['sessions'];

  const rows = await runReport(client, propertyId, {
    dateRanges: [dateRange],
    dimensions: dimensions.map(name => ({ name })),
    metrics: metrics.map(name => ({ name })),
    dimensionFilter: {
      filter: {
        fieldName: 'sessionDefaultChannelGroup',
        inListFilter: {
          values: ['Organic Search', 'Direct', 'Referral', 'Organic Social'],
        },
      },
    },
    orderBys: [
      { dimension: { dimensionName: 'pagePath' } },
      { metric: { metricName: 'sessions' }, desc: true },
    ],
    limit: 500,
  });

  // Group by page path for easier consumption
  const byPage = {};
  for (const row of rows) {
    const path = getDimension(row, dimensions, 'pagePath');
    const channel = getDimension(row, dimensions, 'sessionDefaultChannelGroup');
    const sessions = Math.round(getMetric(row, metrics, 'sessions'));

    if (!byPage[path]) {
      byPage[path] = { pagePath: path, organic: 0, direct: 0, referral: 0, social: 0 };
    }

    if (channel === 'Organic Search') byPage[path].organic += sessions;
    else if (channel === 'Direct') byPage[path].direct += sessions;
    else if (channel === 'Referral') byPage[path].referral += sessions;
    else if (channel === 'Organic Social') byPage[path].social += sessions;
  }

  return Object.values(byPage);
}

/**
 * Fetch top 50 pages ranked by page views.
 *
 * @param {object} client - BetaAnalyticsDataClient instance
 * @param {string} propertyId - Numeric GA4 property ID
 * @param {{ startDate: string, endDate: string }} dateRange
 * @returns {Promise<object[]>} Top 50 pages sorted by page views descending
 */
async function fetchTopPagesByTraffic(client, propertyId, dateRange) {
  const dimensions = ['pagePath', 'pageTitle'];
  const metrics = ['screenPageViews', 'totalUsers', 'sessions'];

  const rows = await runReport(client, propertyId, {
    dateRanges: [dateRange],
    dimensions: dimensions.map(name => ({ name })),
    metrics: metrics.map(name => ({ name })),
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 50,
  });

  return rows.map((row, index) => ({
    rank: index + 1,
    pagePath: getDimension(row, dimensions, 'pagePath'),
    pageTitle: getDimension(row, dimensions, 'pageTitle'),
    pageViews: Math.round(getMetric(row, metrics, 'screenPageViews')),
    uniqueUsers: Math.round(getMetric(row, metrics, 'totalUsers')),
    sessions: Math.round(getMetric(row, metrics, 'sessions')),
  }));
}

/**
 * Derive engagement signals from per-page metrics and traffic sources.
 * No additional API call needed — computed from already-fetched data.
 *
 * @param {object[]} perPageMetrics - Output of fetchPerPageMetrics()
 * @param {object[]} trafficSources - Output of fetchTrafficSourcesPerPage()
 * @returns {object} Engagement signal groups
 */
function computeEngagementSignals(perPageMetrics, trafficSources) {
  // Build a lookup for organic traffic per page
  const organicByPage = {};
  for (const src of trafficSources) {
    organicByPage[src.pagePath] = src.organic ?? 0;
  }

  // Only consider pages with meaningful traffic (10+ views) to filter noise
  const substantialPages = perPageMetrics.filter(p => p.pageViews >= 10);

  // Highest bounce rate — visitors who leave immediately (top 20)
  const highBouncePages = [...substantialPages]
    .sort((a, b) => b.bounceRate - a.bounceRate)
    .slice(0, 20)
    .map(p => ({
      pagePath: p.pagePath,
      bounceRate: p.bounceRate,
      pageViews: p.pageViews,
    }));

  // Highest avg session duration — high intent signals (top 20)
  const highEngagementPages = [...substantialPages]
    .sort((a, b) => b.avgSessionDurationSec - a.avgSessionDurationSec)
    .slice(0, 20)
    .map(p => ({
      pagePath: p.pagePath,
      avgSessionDurationSec: p.avgSessionDurationSec,
      pageViews: p.pageViews,
    }));

  // Pages with zero organic traffic — invisible in search results
  const zeroOrganicPages = perPageMetrics
    .filter(p => p.pageViews >= 10 && (organicByPage[p.pagePath] ?? 0) === 0)
    .sort((a, b) => b.pageViews - a.pageViews)
    .slice(0, 50)
    .map(p => ({
      pagePath: p.pagePath,
      pageViews: p.pageViews,
      organicSessions: 0,
      note: 'Receives traffic but no organic search sessions — not ranking',
    }));

  return {
    highBouncePages,
    highEngagementPages,
    zeroOrganicPages,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether GA4 is configured and usable.
 *
 * Looks for:
 *   1. config.ga4.propertyId (numeric property ID or measurement ID)
 *   2. config.ga4.credentialsPath OR process.env.GOOGLE_APPLICATION_CREDENTIALS
 *
 * @param {object} config - Brad config object
 * @returns {boolean} True if both property ID and credentials path are present
 */
export function isGA4Configured(config) {
  const hasPropertyId = !!(config?.ga4?.propertyId);
  const hasCredentials = !!(
    config?.ga4?.credentialsPath ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
  return hasPropertyId && hasCredentials;
}

/**
 * Fetch all GA4 analytics data for SEO auditing.
 *
 * Returns per-page metrics, traffic source breakdowns, top pages by traffic,
 * and engagement signals (high bounce, high engagement, zero organic pages).
 *
 * Returns null (without throwing) if:
 *   - The @google-analytics/data package is not installed
 *   - GA4 credentials or property ID are not configured
 *   - The API request fails
 *
 * PROPERTY ID NOTE:
 *   Use the numeric property ID (e.g. 123456789), not the measurement ID
 *   (G-XXXXXXX). Find it in GA4 → Admin → Property Settings → Property ID.
 *
 * @param {string} propertyId - Numeric GA4 property ID (e.g. "123456789")
 * @param {object} [options] - Optional configuration overrides
 * @param {number} [options.days=90] - Number of days of history to fetch
 * @param {string} [options.credentialsPath] - Path to service account JSON key file.
 *   Falls back to process.env.GOOGLE_APPLICATION_CREDENTIALS if omitted.
 *
 * @returns {Promise<{
 *   propertyId: string,
 *   dateRange: { startDate: string, endDate: string },
 *   fetchedAt: string,
 *   perPageMetrics: object[],
 *   trafficSourcesPerPage: object[],
 *   topPagesByTraffic: object[],
 *   engagementSignals: {
 *     highBouncePages: object[],
 *     highEngagementPages: object[],
 *     zeroOrganicPages: object[],
 *   },
 * } | null>}
 */
export async function fetchGA4Data(propertyId, options = {}) {
  // Validate property ID format — catch measurement IDs before hitting the API
  if (typeof propertyId === 'string' && propertyId.toUpperCase().startsWith('G-')) {
    console.warn(
      `[GA4] "${propertyId}" is a Measurement ID, not a Property ID.\n` +
      `      The GA4 Data API requires the numeric Property ID.\n` +
      `      Find it in GA4 → Admin → Property Settings → Property ID.`
    );
    return null;
  }

  if (!propertyId) {
    return null;
  }

  // Load the GA4 package
  const packageAvailable = await loadGA4Package();
  if (!packageAvailable) {
    console.warn(
      '[GA4] @google-analytics/data package not found.\n' +
      '      Install it with: npm install @google-analytics/data'
    );
    return null;
  }

  // Resolve credentials
  const credentialsPath = options.credentialsPath || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) {
    console.warn(
      '[GA4] No service account credentials found.\n' +
      '      Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json\n' +
      '      or pass options.credentialsPath.'
    );
    return null;
  }

  try {
    // Set the env var for the duration of the entire fetch operation.
    // The SDK reads credentials lazily (on first API call, not at construction).
    const prevCredEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;

    const client = new BetaAnalyticsDataClient();

    const days = options.days ?? 90;
    const dateRange = buildDateRange(days);

    // Run all three API calls in parallel for speed
    const [perPageMetrics, trafficSourcesPerPage, topPagesByTraffic] = await Promise.all([
      fetchPerPageMetrics(client, propertyId, dateRange),
      fetchTrafficSourcesPerPage(client, propertyId, dateRange),
      fetchTopPagesByTraffic(client, propertyId, dateRange),
    ]);

    const engagementSignals = computeEngagementSignals(perPageMetrics, trafficSourcesPerPage);

    // Restore env var now that all API calls are complete
    if (prevCredEnv === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = prevCredEnv;
    }

    return {
      propertyId,
      dateRange,
      fetchedAt: new Date().toISOString(),
      perPageMetrics,
      trafficSourcesPerPage,
      topPagesByTraffic,
      engagementSignals,
    };
  } catch (err) {
    console.warn(`[GA4] Failed to fetch analytics data: ${err.message}`);
    return null;
  }
}
