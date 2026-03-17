/**
 * Web Crawler Tool — fetches and parses web pages for analysis
 * Uses cheerio for HTML parsing (no headless browser needed for most pages)
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as cheerio from 'cheerio';

export const crawlPage = tool(
  async ({ url }) => {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Brad-CMO/0.1 (marketing-analysis)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return JSON.stringify({ error: `HTTP ${response.status}: ${response.statusText}`, url });
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove script, style, and nav clutter
      $('script, style, noscript, iframe').remove();

      // Extract SEO-relevant metadata
      const meta = {
        url,
        title: $('title').text().trim(),
        description: $('meta[name="description"]').attr('content') || '',
        keywords: $('meta[name="keywords"]').attr('content') || '',
        ogTitle: $('meta[property="og:title"]').attr('content') || '',
        ogDescription: $('meta[property="og:description"]').attr('content') || '',
        ogImage: $('meta[property="og:image"]').attr('content') || '',
        canonical: $('link[rel="canonical"]').attr('href') || '',
        robots: $('meta[name="robots"]').attr('content') || '',
        viewport: $('meta[name="viewport"]').attr('content') || '',
      };

      // Extract headings hierarchy
      const headings = [];
      $('h1, h2, h3, h4').each((_, el) => {
        headings.push({
          level: el.tagName,
          text: $(el).text().trim().substring(0, 200),
        });
      });

      // Extract links
      const links = {
        internal: [],
        external: [],
      };
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

        try {
          const linkUrl = new URL(href, url);
          const siteHost = new URL(url).hostname;
          const linkObj = { href: linkUrl.href, text: $(el).text().trim().substring(0, 100) };

          if (linkUrl.hostname === siteHost) {
            if (links.internal.length < 50) links.internal.push(linkObj);
          } else {
            if (links.external.length < 20) links.external.push(linkObj);
          }
        } catch {
          // invalid URL, skip
        }
      });

      // Extract images (for alt text audit)
      const images = [];
      $('img').each((_, el) => {
        if (images.length >= 30) return;
        images.push({
          src: $(el).attr('src') || '',
          alt: $(el).attr('alt') || '',
          hasAlt: !!$(el).attr('alt'),
        });
      });

      // Extract main body text (truncated)
      const bodyText = $('body').text()
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 5000);

      // Structured data
      const jsonLd = [];
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          jsonLd.push(JSON.parse($(el).html()));
        } catch {
          // malformed JSON-LD
        }
      });

      return JSON.stringify({
        meta,
        headings,
        links: {
          internal: links.internal.length,
          external: links.external.length,
          internalLinks: links.internal,
          externalSample: links.external.slice(0, 10),
        },
        images: {
          total: images.length,
          missingAlt: images.filter(i => !i.hasAlt).length,
          sample: images.slice(0, 10),
        },
        jsonLd,
        bodyTextPreview: bodyText.substring(0, 2000),
        bodyTextLength: bodyText.length,
      }, null, 2);
    } catch (err) {
      return JSON.stringify({ error: err.message, url });
    }
  },
  {
    name: 'crawl_page',
    description: 'Fetch and analyze a web page. Returns SEO metadata, headings, links, images, structured data, and body text. Use this to understand a website\'s content and SEO health.',
    schema: z.object({
      url: z.string().url().describe('The full URL to crawl (e.g., https://lanaai.io)'),
    }),
  }
);

export const crawlSitemap = tool(
  async ({ url }) => {
    try {
      // Try common sitemap locations
      const siteUrl = new URL(url);
      const sitemapUrls = [
        `${siteUrl.origin}/sitemap.xml`,
        `${siteUrl.origin}/sitemap_index.xml`,
        `${siteUrl.origin}/sitemap`,
      ];

      for (const sitemapUrl of sitemapUrls) {
        try {
          const response = await fetch(sitemapUrl, {
            headers: { 'User-Agent': 'Brad-CMO/0.1' },
            signal: AbortSignal.timeout(10000),
          });

          if (!response.ok) continue;

          const text = await response.text();
          const $ = cheerio.load(text, { xmlMode: true });

          const pages = [];
          $('url').each((_, el) => {
            pages.push({
              loc: $('loc', el).text(),
              lastmod: $('lastmod', el).text() || null,
              priority: $('priority', el).text() || null,
              changefreq: $('changefreq', el).text() || null,
            });
          });

          if (pages.length > 0) {
            return JSON.stringify({
              sitemapUrl,
              totalPages: pages.length,
              pages: pages.slice(0, 100),
            }, null, 2);
          }
        } catch {
          continue;
        }
      }

      return JSON.stringify({ error: 'No sitemap found', triedUrls: sitemapUrls });
    } catch (err) {
      return JSON.stringify({ error: err.message });
    }
  },
  {
    name: 'crawl_sitemap',
    description: 'Find and parse the XML sitemap for a website. Returns all indexed URLs with their last modified dates and priorities.',
    schema: z.object({
      url: z.string().url().describe('The website base URL (e.g., https://lanaai.io)'),
    }),
  }
);

export const crawlSite = tool(
  async ({ url, maxPages }) => {
    const limit = maxPages || 10;
    const siteHost = new URL(url).hostname;
    const visited = new Set();
    const queue = [url];
    const results = [];

    // Prevent MaxListenersExceededWarning from AbortSignal.timeout() per page
    if (typeof process !== 'undefined') {
      process.setMaxListeners(Math.max(process.getMaxListeners(), limit + 10));
    }

    while (queue.length > 0 && visited.size < limit) {
      const currentUrl = queue.shift();

      // Normalize URL (remove trailing slash, fragment)
      let normalized;
      try {
        const u = new URL(currentUrl);
        u.hash = '';
        normalized = u.href.replace(/\/$/, '');
      } catch {
        continue;
      }

      if (visited.has(normalized)) continue;
      visited.add(normalized);

      try {
        const response = await fetch(currentUrl, {
          headers: {
            'User-Agent': 'Brad-CMO/0.1 (marketing-analysis)',
            'Accept': 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          results.push({ url: currentUrl, error: `HTTP ${response.status}` });
          continue;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) {
          results.push({ url: currentUrl, error: `Not HTML: ${contentType}` });
          continue;
        }

        const html = await response.text();
        const $ = cheerio.load(html);
        $('script, style, noscript, iframe').remove();

        const title = $('title').text().trim();
        const description = $('meta[name="description"]').attr('content') || '';
        const canonical = $('link[rel="canonical"]').attr('href') || '';
        const h1 = $('h1').first().text().trim();

        const headings = [];
        $('h1, h2, h3').each((_, el) => {
          headings.push({ level: el.tagName, text: $(el).text().trim().substring(0, 150) });
        });

        const images = { total: $('img').length, missingAlt: $('img:not([alt]), img[alt=""]').length };

        const bodyText = $('body').text().replace(/\\s+/g, ' ').trim();

        // Discover internal links to crawl next
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
          try {
            const linkUrl = new URL(href, currentUrl);
            linkUrl.hash = '';
            const linkNorm = linkUrl.href.replace(/\/$/, '');
            if (linkUrl.hostname === siteHost && !visited.has(linkNorm)) {
              queue.push(linkUrl.href);
            }
          } catch { /* skip invalid */ }
        });

        results.push({
          url: currentUrl,
          title,
          titleLength: title.length,
          description,
          descriptionLength: description.length,
          canonical,
          h1,
          headings,
          images,
          bodyTextLength: bodyText.length,
          estimatedWords: bodyText.split(/\\s+/).length,
        });
      } catch (err) {
        results.push({ url: currentUrl, error: err.message });
      }
    }

    return JSON.stringify({
      siteUrl: url,
      pagesCrawled: results.length,
      pagesQueued: queue.length,
      results,
    }, null, 2);
  },
  {
    name: 'crawl_site',
    description: 'Crawl an entire website by following internal links starting from the given URL. Returns SEO data for every page found (up to maxPages). Use this for comprehensive site audits instead of crawling pages one by one.',
    schema: z.object({
      url: z.string().url().describe('The starting URL (e.g., https://lanaai.io)'),
      maxPages: z.number().nullable().default(10).describe('Maximum pages to crawl (default 10)'),
    }),
  }
);
