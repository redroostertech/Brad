/**
 * Search Tool — web search for competitive analysis, trend monitoring
 * Uses DuckDuckGo HTML (no API key needed) as a free fallback
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as cheerio from 'cheerio';

export const webSearch = tool(
  async ({ query, numResults }) => {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return JSON.stringify({ error: `Search failed: HTTP ${response.status}` });
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const results = [];
      $('.result').each((_, el) => {
        if (results.length >= (numResults || 10)) return;

        const titleEl = $(el).find('.result__a');
        const snippetEl = $(el).find('.result__snippet');
        const urlEl = $(el).find('.result__url');

        const title = titleEl.text().trim();
        const snippet = snippetEl.text().trim();
        const resultUrl = urlEl.text().trim();

        if (title && snippet) {
          results.push({ title, snippet, url: resultUrl });
        }
      });

      return JSON.stringify({
        query,
        resultCount: results.length,
        results,
      }, null, 2);
    } catch (err) {
      return JSON.stringify({ error: err.message, query });
    }
  },
  {
    name: 'web_search',
    description: 'Search the web using DuckDuckGo. Use for competitive analysis, trend research, finding relevant discussions, or checking brand mentions.',
    schema: z.object({
      query: z.string().describe('Search query'),
      numResults: z.number().nullable().default(10).describe('Max results to return (default 10)'),
    }),
  }
);
