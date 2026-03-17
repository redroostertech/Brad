/**
 * Keyword Research Tool — discovers keyword opportunities without any API keys.
 *
 * Three data sources, all free:
 *   1. Google Autocomplete  — real-time query suggestions from the search bar
 *   2. People Also Ask      — question-based keywords from the Google SERP PAA box
 *   3. Related Searches     — bottom-of-SERP keyword variations
 *
 * All functions handle errors gracefully and return empty arrays on failure
 * rather than throwing, so a single failed request never breaks a full research run.
 */

import * as cheerio from 'cheerio';

/** Standard Chrome User-Agent used across all requests. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Milliseconds to wait between Google SERP requests to reduce block risk. */
const RATE_LIMIT_MS = 500;

/**
 * Pause execution for a given number of milliseconds.
 *
 * @param {number} ms - Duration to sleep.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Build the seed variations used to expand autocomplete coverage.
 * Each prefix/suffix pattern surfaces a different intent cluster.
 *
 * @param {string} seed - The original seed keyword.
 * @returns {string[]} Array of query strings to feed into autocomplete.
 */
function buildAutocompleteVariations(seed) {
  return [
    seed,
    `${seed} for`,
    `${seed} vs`,
    `how to ${seed}`,
    `best ${seed}`,
    `what is ${seed}`,
  ];
}

// ---------------------------------------------------------------------------
// 1. Google Autocomplete Scraper
// ---------------------------------------------------------------------------

/**
 * Fetch Google Autocomplete suggestions for a seed keyword and a set of
 * intent-based variations derived from that seed.
 *
 * Hits the public Firefox suggest endpoint which returns a JSON array — no
 * API key or authentication required.
 *
 * @param {string} seed - The base keyword to research (e.g. "legal AI software").
 * @param {object} [options={}] - Optional configuration.
 * @param {number} [options.timeoutMs=10000] - Per-request timeout in milliseconds.
 * @returns {Promise<Array<{suggestion: string, source: string}>>}
 *   Deduplicated suggestions, each tagged with the variation query that produced them.
 *
 * @example
 * const results = await getAutocompleteSuggestions('legal AI software');
 * // [
 * //   { suggestion: 'legal AI software for small firms', source: 'legal AI software for' },
 * //   { suggestion: 'best legal AI software 2024',       source: 'best legal AI software' },
 * //   ...
 * // ]
 */
export async function getAutocompleteSuggestions(seed, options = {}) {
  const { timeoutMs = 10000 } = options;
  const variations = buildAutocompleteVariations(seed);
  const seen = new Set();
  const results = [];

  for (const variation of variations) {
    try {
      const encoded = encodeURIComponent(variation);
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encoded}`;

      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) continue;

      // Response shape: [queryString, [suggestion, suggestion, ...]]
      const json = await response.json();
      const suggestions = Array.isArray(json[1]) ? json[1] : [];

      for (const suggestion of suggestions) {
        const normalized = suggestion.trim().toLowerCase();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        results.push({ suggestion: suggestion.trim(), source: variation });
      }
    } catch {
      // Network error, timeout, or parse failure — skip this variation silently.
    }

    // Rate-limit between requests (skip delay after the last iteration).
    if (variation !== variations[variations.length - 1]) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 2. People Also Ask Scraper
// ---------------------------------------------------------------------------

/**
 * Scrape the "People also ask" question box from a Google SERP.
 *
 * Google renders PAA boxes as `<div data-initq>` elements containing the
 * question text. If no PAA box is present (e.g. Google returns a CAPTCHA or
 * the query has no question intent) an empty array is returned.
 *
 * @param {string} query - The search query (e.g. "legal AI software").
 * @param {object} [options={}] - Optional configuration.
 * @param {number} [options.timeoutMs=10000] - Request timeout in milliseconds.
 * @returns {Promise<string[]>} Array of question strings from the PAA box.
 *
 * @example
 * const questions = await getPeopleAlsoAsk('legal AI software');
 * // [
 * //   'What is the best AI for law firms?',
 * //   'How does legal AI software work?',
 * //   ...
 * // ]
 */
export async function getPeopleAlsoAsk(query, options = {}) {
  const { timeoutMs = 10000 } = options;

  try {
    const encoded = encodeURIComponent(query);
    const url = `https://www.google.com/search?q=${encoded}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) return [];

    const html = await response.text();
    const $ = cheerio.load(html);
    const questions = [];
    const seen = new Set();

    // Google PAA questions appear in several possible selector patterns
    // depending on the rendered variant. We try each in order.
    const selectors = [
      '[data-initq]',           // Most common structured attribute
      '.related-question-pair', // Alternative class used in some variants
      '[jsname="yEVEwb"]',      // jsname attribute variant
    ];

    for (const selector of selectors) {
      $(selector).each((_, el) => {
        // The question text may be in an attribute or in the element's text.
        const fromAttr = $(el).attr('data-initq') || '';
        const fromText = $(el).text().trim();
        const question = (fromAttr || fromText).trim();

        if (!question || question.length < 10) return;

        const normalized = question.toLowerCase();
        if (seen.has(normalized)) return;
        seen.add(normalized);
        questions.push(question);
      });

      if (questions.length > 0) break; // Found results with this selector, stop trying.
    }

    // Fallback: look for any text that looks like a question inside
    // the PAA section container (Google sometimes restructures the DOM).
    if (questions.length === 0) {
      $('span, div').each((_, el) => {
        const text = $(el).text().trim();
        // Heuristic: short-ish text that ends with a question mark
        if (text.length > 15 && text.length < 200 && text.endsWith('?')) {
          const normalized = text.toLowerCase();
          if (!seen.has(normalized)) {
            seen.add(normalized);
            questions.push(text);
          }
        }
      });
    }

    return questions;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 3. Related Searches Scraper
// ---------------------------------------------------------------------------

/**
 * Scrape the "Related searches" section from the bottom of a Google SERP.
 *
 * These are terms that Google considers semantically close to the query and
 * are excellent candidates for long-tail keyword expansion.
 *
 * @param {string} query - The search query (e.g. "legal AI software").
 * @param {object} [options={}] - Optional configuration.
 * @param {number} [options.timeoutMs=10000] - Request timeout in milliseconds.
 * @returns {Promise<string[]>} Array of related search term strings.
 *
 * @example
 * const related = await getRelatedSearches('legal AI software');
 * // [
 * //   'AI contract review software',
 * //   'legal research AI tools',
 * //   ...
 * // ]
 */
export async function getRelatedSearches(query, options = {}) {
  const { timeoutMs = 10000 } = options;

  try {
    const encoded = encodeURIComponent(query);
    const url = `https://www.google.com/search?q=${encoded}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) return [];

    const html = await response.text();
    const $ = cheerio.load(html);
    const terms = [];
    const seen = new Set();

    // Google related searches appear under several selector patterns.
    const selectors = [
      '[data-q]',              // data-q attribute on related search chips
      '.k8XOCe',               // Related search chip class
      '[jsname="bVqjv"]',      // jsname variant
      '#botstuff a',           // Bottom-of-page links section
    ];

    for (const selector of selectors) {
      $(selector).each((_, el) => {
        // The term may be in data-q or in the element text.
        const fromAttr = $(el).attr('data-q') || '';
        const fromText = $(el).text().trim();
        const term = (fromAttr || fromText).trim();

        // Filter out empty strings, navigation text, and the query itself.
        if (!term || term.length < 5 || term.toLowerCase() === query.toLowerCase()) return;
        // Skip terms that look like navigation (short or contain slashes/colons).
        if (term.includes('://') || term.length > 150) return;

        const normalized = term.toLowerCase();
        if (seen.has(normalized)) return;
        seen.add(normalized);
        terms.push(term);
      });

      if (terms.length > 0) break;
    }

    return terms;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 4. Combined Keyword Research
// ---------------------------------------------------------------------------

/**
 * Run a full keyword research pass across multiple seed keywords.
 *
 * For each seed, this function fetches autocomplete suggestions, People Also
 * Ask questions, and related searches, then aggregates and deduplicates
 * all results into a single structured report.
 *
 * A 500ms rate-limiting delay is inserted between each Google SERP request
 * (PAA and related searches share the same page fetch, so only one request
 * per seed is made to google.com).
 *
 * @param {string[]} seedKeywords - Array of seed keywords to research.
 *   Typically sourced from `config.brand.keywords.primary`.
 * @param {object} [options={}] - Optional configuration.
 * @param {number} [options.timeoutMs=10000] - Per-request timeout in milliseconds.
 * @returns {Promise<{
 *   seeds: string[],
 *   autocomplete: Array<{suggestion: string, source: string}>,
 *   questions: string[],
 *   relatedSearches: string[],
 *   totalKeywords: number
 * }>} Aggregated keyword research results.
 *
 * @example
 * const results = await researchKeywords(['legal AI software', 'AI for law firms']);
 * // {
 * //   seeds: ['legal AI software', 'AI for law firms'],
 * //   autocomplete: [
 * //     { suggestion: 'legal AI software for small firms', source: 'legal AI software for' },
 * //     ...
 * //   ],
 * //   questions: [
 * //     'What is the best AI for law firms?',
 * //     ...
 * //   ],
 * //   relatedSearches: [
 * //     'AI contract review software',
 * //     ...
 * //   ],
 * //   totalKeywords: 47
 * // }
 */
export async function researchKeywords(seedKeywords, options = {}) {
  const seeds = Array.isArray(seedKeywords) ? seedKeywords : [seedKeywords];

  // Dedup trackers shared across all seeds.
  const seenAutocomplete = new Set();
  const seenQuestions = new Set();
  const seenRelated = new Set();

  const autocomplete = [];
  const questions = [];
  const relatedSearches = [];

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];

    // --- Autocomplete (makes several requests internally with its own rate limiting) ---
    const acResults = await getAutocompleteSuggestions(seed, options);
    for (const item of acResults) {
      const key = item.suggestion.toLowerCase();
      if (!seenAutocomplete.has(key)) {
        seenAutocomplete.add(key);
        autocomplete.push(item);
      }
    }

    // Rate limit before hitting the SERP for PAA + related searches.
    await sleep(RATE_LIMIT_MS);

    // --- People Also Ask ---
    const paaResults = await getPeopleAlsoAsk(seed, options);
    for (const question of paaResults) {
      const key = question.toLowerCase();
      if (!seenQuestions.has(key)) {
        seenQuestions.add(key);
        questions.push(question);
      }
    }

    // Rate limit before related searches (different page request).
    await sleep(RATE_LIMIT_MS);

    // --- Related Searches ---
    const relatedResults = await getRelatedSearches(seed, options);
    for (const term of relatedResults) {
      const key = term.toLowerCase();
      if (!seenRelated.has(key)) {
        seenRelated.add(key);
        relatedSearches.push(term);
      }
    }

    // Rate limit between seeds (skip after the last seed).
    if (i < seeds.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  const totalKeywords = autocomplete.length + questions.length + relatedSearches.length;

  return {
    seeds,
    autocomplete,
    questions,
    relatedSearches,
    totalKeywords,
  };
}
