/**
 * SEO Auditor Agent — runs page-by-page SEO audits
 *
 * Strategy: crawl all pages first, then analyze ONE page at a time
 * via separate LLM calls. Assembles the final report in Node.js.
 * This prevents the LLM from skipping pages due to output length limits.
 */

import { createBradAgent, runAgent } from '../core/agent.js';
import { crawlPage, crawlSitemap, crawlSite } from '../tools/web-crawler.js';
import { webSearch } from '../tools/search.js';
import { createFileTools } from '../tools/file-ops.js';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function derivePageUrls(siteUrl, config) {
  const focus = config?.focus || [];
  const siteName = config?.sites?.[0]?.name || '';
  const siteSlug = siteName.toLowerCase().replace(/\s+/g, '-');

  const seen = new Set();
  const pageFiles = focus.filter(f => {
    if (!f.includes('/pages/') || !f.endsWith('.ejs') || f.includes(' copy')) return false;
    const dir = f.split('/pages/')[0];
    if (siteSlug && !dir.includes(siteSlug)) return false;
    if (dir === 'views') return false;
    if (seen.has(f)) return false;
    seen.add(f);
    return true;
  });

  if (pageFiles.length === 0) {
    return [
      `${siteUrl}/`, `${siteUrl}/features`, `${siteUrl}/about`,
      `${siteUrl}/security`, `${siteUrl}/product`, `${siteUrl}/contact`,
      `${siteUrl}/demo`, `${siteUrl}/pricing`,
    ];
  }

  const skipPages = ['404', '500', 'error', 'oauth-redirect', 'oauth-error', 'home-2', 'landing'];

  return pageFiles.map(f => {
    const pageName = f.split('/').pop().replace('.ejs', '').replace(/_/g, '-');
    if (skipPages.includes(pageName)) return null;
    if (pageName === 'home') return `${siteUrl}/`;
    return `${siteUrl}/${pageName}`;
  }).filter(Boolean);
}

// ── Single-page analysis prompt ──────────────────────────────────

const PAGE_ANALYSIS_PROMPT = (pageData, siteUrl, brandContext, config, allPageUrls) => {
  const primaryKeywords = config?.brand?.keywords?.primary?.slice(0, 5).join(', ') || 'legal AI, on-premise AI, law firm AI';
  const secondaryKeywords = config?.brand?.keywords?.secondary?.slice(0, 5).join(', ') || '';

  return `
Analyze this SINGLE page for SEO. You are given the raw crawl data below. Write a thorough, specific analysis.

## Page Data (from crawl)
\`\`\`json
${JSON.stringify(pageData, null, 2)}
\`\`\`

## Brand Keywords to Check For
- Primary: ${primaryKeywords}
- Secondary: ${secondaryKeywords}

## Other Pages on This Site (for internal linking analysis)
${allPageUrls.map(u => `- ${u}`).join('\n')}

## Write Your Analysis

Output ONLY the markdown block below, nothing else. No preamble, no summary after.

### ${pageData.meta?.title?.split(' - ')[0]?.split(' | ')[0] || 'Page'} — ${pageData.url || pageData.meta?.canonical || 'unknown'}

**Raw Data:**
- Title: "${pageData.meta?.title || 'missing'}" (${pageData.meta?.title?.length || 0} chars)
- Meta Description: "${pageData.meta?.description || 'missing'}" (${pageData.meta?.description?.length || 0} chars)
- Canonical: ${pageData.meta?.canonical || 'missing'}
- H1: "${pageData.headings?.find(h => h.level === 'h1')?.text || 'missing'}"
- Headings: ${JSON.stringify(pageData.headings?.map(h => h.level + ': ' + h.text) || [])}
- Images: ${pageData.images?.total || 0} total, ${pageData.images?.missingAlt || 0} missing alt
- Links: ${pageData.links?.internal || 0} internal, ${pageData.links?.external || 0} external
- Body Length: ${pageData.bodyTextLength || 0} chars
- OG Image: ${pageData.meta?.ogImage ? 'present' : 'missing'}
- JSON-LD: ${pageData.jsonLd?.length > 0 ? 'present' : 'missing'}

**Title Tag Analysis:**
[Analyze: Is length within 50-60 chars? Does it contain primary keywords (${primaryKeywords})? Would a lawyer click this in SERPs? Is the brand positioned correctly? If weak, suggest a specific rewrite.]

**Meta Description Analysis:**
[Analyze: Is length 150-160 chars? Does it have a call to action? Does it include keywords naturally? Suggest a specific rewrite if it can be improved.]

**Heading Structure Analysis:**
[Analyze: Exactly one H1? Does H1 contain a keyword? Is hierarchy clean (H1→H2→H3, no skips)? Are H2s clear content sections? Any headings used for styling instead of structure?]

**Content Assessment:**
[Analyze: Is body text substantive (>1000 chars) or thin? Are target keywords present? What topics should this page cover that it doesn't? How does it compare to what competitors likely cover?]

**Internal Linking:**
[Analyze: Is the page well-connected? Which OTHER pages on the site (see list above) should this page link to but doesn't? Is anchor text descriptive?]

**Technical Issues:**
[Analyze: Does canonical match expected URL (watch www vs non-www)? OG tags complete? What JSON-LD schema type should this page have? Any markup issues?]

**Specific Suggestions:**
1. [Actionable suggestion — explain WHY and expected IMPACT]
2. [Another — WHY and IMPACT]
3. [Another — WHY and IMPACT]

---
`;
};

// ── Summary prompt (cross-site issues + action plan) ─────────────

const SUMMARY_PROMPT = (siteName, pageAnalyses, sitemapData, competitiveData) => `
You have the individual page analyses and supporting data below. Write the final summary sections of the SEO audit.

## Individual Page Analyses Already Written
${pageAnalyses.length} pages analyzed.

## Sitemap Data
${sitemapData}

## Competitive Search Data
${competitiveData}

## Write These Sections

Output ONLY the markdown below:

## Sitemap Analysis
[Analyze the sitemap data: URL, pages found, missing pages, domain mismatch issues]

## Competitive Search Results
[For each search query, list the actual results. What competitors are doing that we aren't.]

## Cross-Site Issues
[Patterns across multiple pages — e.g., "JSON-LD missing on all pages" is ONE issue here, not repeated per page]

## Priority Action Plan

### Critical (fix this week)
- [ ] [Issue] — **Why it matters:** [SEO impact explanation] — **Fix:** [specific steps] — **Pages affected:** [list]

### Important (fix this month)
- [ ] [Issue] — **Why it matters:** [explanation] — **Fix:** [steps] — **Pages affected:** [list]

### Opportunities (plan for next quarter)
- [ ] [Opportunity] — **Why it matters:** [explanation] — **How:** [approach] — **Expected impact:** [what improves]
`;

// ── Main audit runner ────────────────────────────────────────────

export async function runSEOAudit(llm, workspace, options = {}) {
  const log = options.log || (() => {});
  const config = await workspace.loadConfig();
  const site = config.sites[0];

  if (!site) {
    throw new Error('No site configured. Run: brad init --site <url>');
  }

  const brandContext = await workspace.loadBrandContext();
  const pageUrls = derivePageUrls(site.url, config);

  log(`Auditing ${site.name} — ${pageUrls.length} pages to analyze`);

  // ── Phase 1: Crawl every page ──────────────────────────────
  log('Phase 1: Crawling all pages...');
  const pageResults = [];

  for (const url of pageUrls) {
    log(`  Crawling: ${url}`);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Brad-CMO/0.1 (seo-audit)', 'Accept': 'text/html' },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        log(`  ⚠ ${url} returned HTTP ${response.status}`);
        pageResults.push({ url, error: `HTTP ${response.status}` });
        continue;
      }

      const html = await response.text();
      const { load } = await import('cheerio');
      const $ = load(html);
      $('script, style, noscript, iframe').remove();

      const meta = {
        url,
        title: $('title').text().trim(),
        description: $('meta[name="description"]').attr('content') || '',
        canonical: $('link[rel="canonical"]').attr('href') || '',
        ogTitle: $('meta[property="og:title"]').attr('content') || '',
        ogDescription: $('meta[property="og:description"]').attr('content') || '',
        ogImage: $('meta[property="og:image"]').attr('content') || '',
        robots: $('meta[name="robots"]').attr('content') || '',
      };

      const headings = [];
      $('h1, h2, h3, h4').each((_, el) => {
        headings.push({ level: el.tagName, text: $(el).text().trim().substring(0, 200) });
      });

      const internalLinks = [];
      const externalLinks = [];
      const siteHost = new URL(url).hostname;
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
        try {
          const linkUrl = new URL(href, url);
          if (linkUrl.hostname === siteHost) {
            internalLinks.push({ href: linkUrl.href, text: $(el).text().trim().substring(0, 80) });
          } else {
            externalLinks.push({ href: linkUrl.href, text: $(el).text().trim().substring(0, 80) });
          }
        } catch { /* skip */ }
      });

      const images = { total: $('img').length, missingAlt: $('img:not([alt]), img[alt=""]').length };
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
      const jsonLd = [];
      $('script[type="application/ld+json"]').each((_, el) => {
        try { jsonLd.push(JSON.parse($(el).html())); } catch { /* skip */ }
      });

      pageResults.push({
        url,
        meta,
        headings,
        links: { internal: internalLinks.length, external: externalLinks.length },
        images,
        bodyTextLength: bodyText.length,
        bodyTextPreview: bodyText.substring(0, 1500),
        jsonLd,
      });

      log(`  ✓ ${url} (${meta.title.substring(0, 50)}...)`);
    } catch (err) {
      log(`  ⚠ ${url}: ${err.message}`);
      pageResults.push({ url, error: err.message });
    }
  }

  // ── Phase 2: Crawl sitemap ─────────────────────────────────
  log('Phase 2: Checking sitemap...');
  let sitemapData = 'No sitemap found';
  try {
    const fileTools = createFileTools(workspace);
    const sitemapAgent = createBradAgent(llm, [crawlSitemap], {});
    const sitemapResult = await runAgent(
      sitemapAgent,
      `Crawl the sitemap at ${site.url}. Return the raw results.`,
      { onToolCall: (n, a) => log(`  Checking: ${a.url || site.url}`), onToolResult: () => {} }
    );
    sitemapData = sitemapResult.content;
  } catch (err) {
    log(`  Sitemap check failed: ${err.message}`);
  }

  // ── Phase 3: Competitive search ────────────────────────────
  log('Phase 3: Competitive search...');
  const keywords = config?.brand?.keywords?.primary?.slice(0, 3) || ['legal AI software'];
  let competitiveData = '';

  for (const kw of keywords) {
    log(`  Searching: "${kw}"`);
    try {
      const encodedQuery = encodeURIComponent(kw);
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(10000),
      });
      const html = await response.text();
      const { load } = await import('cheerio');
      const $ = load(html);
      const results = [];
      $('.result').each((_, el) => {
        if (results.length >= 5) return;
        const title = $(el).find('.result__a').text().trim();
        const snippet = $(el).find('.result__snippet').text().trim();
        const resultUrl = $(el).find('.result__url').text().trim();
        if (title) results.push({ title, snippet, url: resultUrl });
      });
      competitiveData += `\n### Search: "${kw}"\n`;
      results.forEach((r, i) => {
        competitiveData += `${i + 1}. ${r.title} — ${r.url}\n   "${r.snippet}"\n`;
      });
    } catch (err) {
      competitiveData += `\n### Search: "${kw}"\nFailed: ${err.message}\n`;
    }
  }

  // ── Phase 4: Analyze each page individually via LLM ────────
  log(`Phase 4: Analyzing ${pageResults.filter(p => !p.error).length} pages (one at a time)...`);
  const pageAnalyses = [];
  const allPageUrls = pageResults.filter(p => !p.error).map(p => p.url);

  for (const page of pageResults) {
    if (page.error) {
      pageAnalyses.push(`### ${page.url}\n**Error:** ${page.error} — page could not be crawled.\n\n---\n`);
      continue;
    }

    log(`  Analyzing: ${page.url}`);
    try {
      const result = await llm.invoke([
        { role: 'system', content: 'You are an expert SEO auditor. Output only the markdown analysis requested. No preamble, no commentary.' },
        { role: 'user', content: PAGE_ANALYSIS_PROMPT(page, site.url, brandContext, config, allPageUrls) },
      ]);
      const content = typeof result.content === 'string' ? result.content : result.content?.[0]?.text || '';
      pageAnalyses.push(content.trim());
      log(`  ✓ Done: ${page.url}`);
    } catch (err) {
      log(`  ⚠ Analysis failed for ${page.url}: ${err.message}`);
      pageAnalyses.push(`### ${page.url}\n**Analysis failed:** ${err.message}\n\n---\n`);
    }
  }

  // ── Phase 5: Generate summary ──────────────────────────────
  log('Phase 5: Generating summary...');
  let summary = '';
  try {
    const result = await llm.invoke([
      { role: 'system', content: 'You are an expert SEO auditor. Output only the markdown sections requested.' },
      { role: 'user', content: SUMMARY_PROMPT(site.name, pageAnalyses, sitemapData, competitiveData) },
    ]);
    summary = typeof result.content === 'string' ? result.content : result.content?.[0]?.text || '';
  } catch (err) {
    log(`  Summary generation failed: ${err.message}`);
    summary = `## Summary\nFailed to generate: ${err.message}`;
  }

  // ── Phase 6: Assemble final report ─────────────────────────
  log('Phase 6: Assembling report...');
  const report = [
    `# SEO Audit — ${site.name} — ${todayStr()}`,
    '',
    `## Pages Audited (${pageResults.length})`,
    ...pageResults.map(p => `- ${p.url}${p.error ? ' ⚠ ' + p.error : ''}`),
    '',
    '## Page-by-Page Analysis',
    '',
    ...pageAnalyses,
    '',
    summary,
  ].join('\n');

  const filename = `${todayStr()}-seo-audit.md`;
  await workspace.saveFinding(filename, report);
  log(`✓ Report saved: ${filename} (${pageAnalyses.length} pages, ${report.length} chars)`);

  await workspace.appendHistory({
    action: 'seo_audit',
    site: site.url,
    date: todayStr(),
    pagesAudited: pageResults.length,
    pagesAnalyzed: pageAnalyses.length,
  });

  return { content: `SEO audit complete. ${pageResults.length} pages audited. Report saved to .brad/findings/${filename}` };
}
