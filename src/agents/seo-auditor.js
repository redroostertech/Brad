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
import { enrichWithAnalytics, formatAnalyticsForPrompt } from '../tools/analytics-enricher.js';

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

  const skipPages = ['404', '500', 'error', 'oauth-redirect', 'oauth-error', 'home-2', 'landing', 'estate-planning-bh'];

  // Map EJS filenames to actual route paths where they differ
  const routeOverrides = {
    'privacy': 'privacy-policy',
    'terms': 'terms-of-service',
  };

  return pageFiles.map(f => {
    const pageName = f.split('/').pop().replace('.ejs', '').replace(/_/g, '-');
    if (skipPages.includes(pageName)) return null;
    if (pageName === 'home') return `${siteUrl}/`;
    const routePath = routeOverrides[pageName] || pageName;
    return `${siteUrl}/${routePath}`;
  }).filter(Boolean);
}

// ── Single-page analysis prompt ──────────────────────────────────

const PAGE_ANALYSIS_PROMPT = (pageData, siteUrl, brandContext, config, allPageUrls) => {
  const primaryKeywords = config?.brand?.keywords?.primary || [];
  const secondaryKeywords = config?.brand?.keywords?.secondary || [];
  const longTailKeywords = config?.brand?.keywords?.long_tail || [];
  const differentiators = config?.brand?.differentiators || [];
  const competitors = config?.brand?.competitors || [];
  const bodyPreview = pageData.bodyTextPreview || '';

  // Pre-compute keyword presence — use full body text, not just preview
  const allKeywords = [...primaryKeywords, ...secondaryKeywords];
  const fullBodyLower = (pageData.fullBodyText || bodyPreview).toLowerCase();
  const titleLower = (pageData.meta?.title || '').toLowerCase();
  const h1Text = (pageData.headings?.find(h => h.level === 'h1')?.text || '').toLowerCase();
  const headingsText = (pageData.headings || []).map(h => h.text.toLowerCase()).join(' ');

  // Check each keyword: exact match first, then check individual words for partial coverage
  const keywordsInBody = allKeywords.filter(k => {
    const kl = k.toLowerCase();
    if (fullBodyLower.includes(kl)) return true;
    // Partial: if all significant words of the keyword appear in body
    const words = kl.split(/\s+/).filter(w => w.length > 2);
    return words.length > 1 && words.every(w => fullBodyLower.includes(w));
  });
  const keywordsMissing = allKeywords.filter(k => !keywordsInBody.includes(k));
  const keywordsInTitle = primaryKeywords.filter(k => titleLower.includes(k.toLowerCase()));
  const keywordsInH1 = primaryKeywords.filter(k => {
    const kl = k.toLowerCase();
    return h1Text.includes(kl) || headingsText.includes(kl);
  });

  // Determine page type for schema recommendation
  const urlPath = (pageData.url || '').split('/').pop() || 'home';
  const schemaMap = {
    '': 'Organization + WebSite',
    'home': 'Organization + WebSite',
    'about': 'Organization + AboutPage',
    'contact': 'ContactPage',
    'demo': 'Product + Action (ScheduleAction)',
    'features': 'SoftwareApplication + ItemList',
    'product': 'SoftwareApplication',
    'security': 'WebPage + FAQPage (if Q&A present)',
    'edge': 'Product (with offers/pricing)',
    'professional': 'Product (with offers/pricing)',
    'enterprise': 'Product (with offers/pricing)',
    'automations': 'Service',
    'privacy-policy': 'WebPage',
    'terms-of-service': 'WebPage',
  };
  const recommendedSchema = schemaMap[urlPath] || 'WebPage';

  return `
You are an expert SEO consultant analyzing a single page. Be SPECIFIC to THIS page — no generic advice.

## Page Crawl Data
URL: ${pageData.url}
Title: "${pageData.meta?.title}" (${pageData.meta?.title?.length || 0} chars)
Description: "${pageData.meta?.description}" (${pageData.meta?.description?.length || 0} chars)
Canonical: ${pageData.meta?.canonical || 'missing'}
H1: "${pageData.headings?.find(h => h.level === 'h1')?.text || 'missing'}"
Headings: ${JSON.stringify(pageData.headings?.map(h => h.level + ': ' + h.text) || [])}
Images: ${pageData.images?.total || 0} total, ${pageData.images?.missingAlt || 0} missing alt
Links: ${pageData.links?.internal || 0} internal, ${pageData.links?.external || 0} external
Body Length: ${pageData.bodyTextLength || 0} chars
OG Image: ${pageData.meta?.ogImage ? 'present' : 'missing'}
JSON-LD: ${pageData.jsonLd?.length > 0 ? JSON.stringify(pageData.jsonLd) : 'missing'}

## Body Text Preview (first 1500 chars)
${bodyPreview.substring(0, 1500)}

## Pre-Computed Keyword Analysis
- Primary keywords IN body: [${keywordsInBody.join(', ') || 'NONE'}]
- Primary keywords MISSING from body: [${keywordsMissing.join(', ') || 'all present'}]
- Primary keywords in title: [${keywordsInTitle.join(', ') || 'NONE'}]
- Primary keywords in H1: [${keywordsInH1.join(', ') || 'NONE'}]

${pageData.analytics ? formatAnalyticsForPrompt(pageData.analytics) : '## Analytics Data\nNo analytics data available (GSC/GA4 not configured). Suggestions are based on crawl data only.'}

## Brand Context
- Differentiators: ${differentiators.join(' | ')}
- Known competitors: ${competitors.join(', ')}
- Recommended JSON-LD schema for this page: ${recommendedSchema}

## All Site Pages (for internal linking)
${allPageUrls.map(u => `- ${u}`).join('\n')}

## OUTPUT FORMAT — Write ONLY this block:

### ${pageData.meta?.title?.split(' - ')[0]?.split(' | ')[0] || 'Page'} — ${pageData.url}

**Raw Data:**
- Title: "${pageData.meta?.title || 'missing'}" (${pageData.meta?.title?.length || 0} chars)
- Meta Description: "${pageData.meta?.description || 'missing'}" (${pageData.meta?.description?.length || 0} chars)
- Canonical: ${pageData.meta?.canonical || 'missing'}
- H1: "${pageData.headings?.find(h => h.level === 'h1')?.text || 'missing'}"
- Images: ${pageData.images?.total || 0} total, ${pageData.images?.missingAlt || 0} missing alt
- Links: ${pageData.links?.internal || 0} internal, ${pageData.links?.external || 0} external
- Body Length: ${pageData.bodyTextLength || 0} chars
- OG Image: ${pageData.meta?.ogImage ? 'present' : 'missing'}
- JSON-LD: ${pageData.jsonLd?.length > 0 ? 'present' : 'missing'}

**Title Tag Analysis:**
- Current: "${pageData.meta?.title}" (${pageData.meta?.title?.length || 0} chars)
- [Is it 50-60 chars? If over, what text gets cut off in Google results?]
- [Which primary keywords are present/missing? Be specific: "Contains 'law firms' but missing 'legal AI software' and 'on-premise AI'"]
- [Would a managing partner at a mid-size firm click this? Why or why not?]
- Suggested rewrite: "[Provide a specific rewrite that's 50-60 chars, includes a primary keyword, and is compelling]"

**Meta Description Analysis:**
- Current: "${pageData.meta?.description}" (${pageData.meta?.description?.length || 0} chars)
- [Is it 150-160 chars? What gets truncated?]
- [Does it answer "why should I click?" — is there a benefit, stat, or CTA?]
- [Which keywords are naturally included vs missing?]
- Suggested rewrite: "[Provide a specific rewrite with CTA, primary keyword, and benefit — 150-160 chars]"

**Heading Structure:**
- H1: "${pageData.headings?.find(h => h.level === 'h1')?.text || 'missing'}"
- [Does H1 match search intent for this page? What would someone Google to find this page?]
- [Is the hierarchy clean? List any skips (e.g., "jumps from H2 to H4 at 'Results:' — should be H3")]
- [Do H2s form a logical table of contents? Would a scan-reader understand the page structure?]
- [Specific fix: quote the problematic heading and suggest the replacement]

**Keyword Coverage:**
- Found in body: ${keywordsInBody.join(', ') || 'NONE'}
- Missing from body: ${keywordsMissing.join(', ') || 'all present'}
- [For each missing keyword, suggest WHERE in the body text it could be naturally added — reference a specific heading section]
- [Are there long-tail phrases from this list that this page should target? ${longTailKeywords.join(', ')}]
- [What topic does this page NOT cover that a competitor's equivalent page would? Be specific.]

**Internal Linking Assessment:**
- This page links to ${pageData.links?.internal || 0} internal pages
- [List 2-3 specific pages from the site that this page SHOULD link to but doesn't, and WHERE in the content the link should go]
- [Example: "The section 'Types of Automations' should link to /features with anchor text 'Lana AI features' — currently no cross-reference exists"]
- [Does this page link to the /demo or /contact conversion pages? If not, where should a CTA link go?]

**Technical SEO:**
- Canonical: ${pageData.meta?.canonical || 'not set'} ${pageData.meta?.canonical && pageData.meta.canonical.includes('www.') && !pageData.url.includes('www.') ? '⚠ WWW MISMATCH — canonical uses www but site serves without www' : ''}
- OG tags: ${pageData.meta?.ogTitle ? 'title ✓' : 'title ✗'} ${pageData.meta?.ogDescription ? 'desc ✓' : 'desc ✗'} ${pageData.meta?.ogImage ? 'image ✓' : 'image ✗'}
- JSON-LD: ${pageData.jsonLd?.length > 0 ? 'present' : `MISSING — should have: ${recommendedSchema}`}
- [Any other technical issues visible in the markup?]

**Page-Specific Suggestions:**
1. **[Specific action]** — Why: [explain the SEO impact with specifics, e.g., "Pages with FAQ schema see 2-3x more SERP real estate"]. Impact: [what metric improves]. Implementation: [exact steps].
2. **[Specific action]** — Why: [specifics]. Impact: [metric]. Implementation: [steps].
3. **[Specific action]** — Why: [specifics]. Impact: [metric]. Implementation: [steps].

---
`;
};

// ── Summary prompt (cross-site issues + action plan) ─────────────

const SUMMARY_PROMPT = (siteName, pageAnalyses, sitemapData, competitiveData, config) => {
  const differentiators = config?.brand?.differentiators || [];
  const competitors = config?.brand?.competitors || [];

  return `
You are writing the summary sections of an SEO audit for ${siteName}. You have all the individual page analyses already written. Now synthesize the cross-cutting insights.

## Individual Page Analyses (${pageAnalyses.length} pages)
${pageAnalyses.join('\n\n').substring(0, 8000)}

## Sitemap Data
${sitemapData}

## Competitive Search Data
${competitiveData}

## Brand Differentiators (for competitive positioning)
${differentiators.map(d => `- ${d}`).join('\n')}

## Known Competitors
${competitors.join(', ') || 'None specified'}

## OUTPUT — Write these sections:

## Sitemap Analysis
- What sitemap URL was found?
- How many pages are indexed?
- Are there domain mismatches (e.g., sitemap serves URLs for a different domain)?
- Which important pages are MISSING from the sitemap?
- Specific fix with implementation steps

## Competitive Landscape
For each search performed, list the top results and analyze:
- Who dominates the first page for each keyword?
- What content format do top results use (listicles, guides, comparison pages)?
- What keywords/topics do competitors cover that ${siteName} doesn't?
- Where does ${siteName} have an advantage that competitors don't emphasize?
- Specific content pieces ${siteName} should create to compete

## Cross-Site Issues
Aggregate patterns found across all page analyses. For each issue:
- **Issue**: [what's wrong]
- **Scope**: [how many pages / which pages]
- **SEO Impact**: [specific impact — e.g., "Without JSON-LD, pages can't appear as rich results, losing ~30% potential SERP real estate"]
- **Fix**: [exact implementation steps]

List at least 5 cross-site issues. Common ones to check:
- JSON-LD missing across pages
- www vs non-www canonical mismatches
- Thin content pages
- Missing keywords in titles/H1s
- Heading hierarchy violations
- Missing internal links between related pages
- No conversion CTAs on informational pages

## Priority Action Plan

### Critical (fix this week) — list 3-5 items
Each item:
- [ ] **[Action]**
  - **Why:** [Specific SEO impact with data if possible — e.g., "canonical mismatch causes Google to split page authority between two URLs, effectively halving ranking power"]
  - **Fix:** [Step-by-step implementation — be specific enough that a developer can execute without further guidance]
  - **Pages:** [list affected pages]
  - **Estimated effort:** [quick/medium/significant]

### Important (fix this month) — list 3-5 items
Same format as above.

### Quick Wins (< 1 hour each) — list 3-5 items
- [ ] **[Action]** — [one-line description] — Pages: [list]

### Strategic Opportunities (next quarter) — list 3-5 items
- [ ] **[Opportunity]**
  - **Why:** [market/competitive context]
  - **Approach:** [what to create or change]
  - **Expected impact:** [what metrics improve and by approximately how much]

### Content Gaps to Fill — list 3-5 content pieces
- [ ] **[Title of content piece]** — Target keyword: "[keyword]" — Format: [blog/landing page/guide] — Why: [competitive opportunity or user intent gap]
`;
};

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

  // ── Phase 1: Crawl every page (parallel) ───────────────────
  log('Phase 1: Crawling all pages in parallel...');

  async function crawlOnePage(url) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Accept': 'text/html' },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        log(`  ⚠ ${url} — HTTP ${response.status}`);
        return { url, error: `HTTP ${response.status}` };
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

      log(`  ✓ ${url}`);
      return {
        url,
        meta,
        headings,
        links: { internal: internalLinks.length, external: externalLinks.length },
        images,
        bodyTextLength: bodyText.length,
        bodyTextPreview: bodyText.substring(0, 2000),
        fullBodyText: bodyText,
        jsonLd,
      };
    } catch (err) {
      log(`  ⚠ ${url}: ${err.message}`);
      return { url, error: err.message };
    }
  }

  const pageResults = await Promise.all(pageUrls.map(crawlOnePage));

  // ── Phase 1.5: Enrich with Google Analytics data ───────────
  log('Phase 1.5: Enriching with analytics (GSC + GA4)...');
  const enrichedPages = await enrichWithAnalytics(pageResults, config, log);

  // ── Phase 2+3: Sitemap + competitive search (parallel) ─────
  log('Phase 2+3: Sitemap check + competitive search (parallel)...');

  const sitemapPromise = (async () => {
    try {
      log('  Checking sitemap...');
      const sitemapAgent = createBradAgent(llm, [crawlSitemap], {});
      const sitemapResult = await runAgent(
        sitemapAgent,
        `Crawl the sitemap at ${site.url}. Return the raw results.`,
        { onToolCall: (n, a) => log(`  Sitemap: ${a.url || site.url}`), onToolResult: () => {} }
      );
      return sitemapResult.content;
    } catch (err) {
      log(`  Sitemap check failed: ${err.message}`);
      return 'No sitemap found';
    }
  })();

  const competitivePromise = (async () => {
    const keywords = config?.brand?.keywords?.primary?.slice(0, 3) || ['legal AI software'];
    let data = '';
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
        data += `\n### Search: "${kw}"\n`;
        results.forEach((r, i) => {
          data += `${i + 1}. ${r.title} — ${r.url}\n   "${r.snippet}"\n`;
        });
      } catch (err) {
        data += `\n### Search: "${kw}"\nFailed: ${err.message}\n`;
      }
    }
    return data;
  })();

  const [sitemapData, competitiveData] = await Promise.all([sitemapPromise, competitivePromise]);

  // ── Phase 4: Analyze pages via LLM (parallel batches of 4) ─
  const validPages = enrichedPages.filter(p => !p.error);
  const errorPages = enrichedPages.filter(p => p.error);
  const allPageUrls = validPages.map(p => p.url);
  const BATCH_SIZE = 4;

  log(`Phase 4: Analyzing ${validPages.length} pages (${BATCH_SIZE} at a time)...`);

  async function analyzePage(page) {
    log(`  Analyzing: ${page.url}`);
    try {
      const result = await llm.invoke([
        { role: 'system', content: 'You are an expert SEO auditor. Output only the markdown analysis requested. No preamble, no commentary.' },
        { role: 'user', content: PAGE_ANALYSIS_PROMPT(page, site.url, brandContext, config, allPageUrls) },
      ]);
      const content = typeof result.content === 'string' ? result.content : result.content?.[0]?.text || '';
      log(`  ✓ Done: ${page.url}`);
      return { url: page.url, analysis: content.trim() };
    } catch (err) {
      log(`  ⚠ Analysis failed for ${page.url}: ${err.message}`);
      return { url: page.url, analysis: `### ${page.url}\n**Analysis failed:** ${err.message}\n\n---\n` };
    }
  }

  // Process in batches of BATCH_SIZE
  const analysisResults = [];
  for (let i = 0; i < validPages.length; i += BATCH_SIZE) {
    const batch = validPages.slice(i, i + BATCH_SIZE);
    log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(validPages.length / BATCH_SIZE)} (${batch.length} pages)...`);
    const batchResults = await Promise.all(batch.map(analyzePage));
    analysisResults.push(...batchResults);
  }

  // Assemble in original URL order + error pages
  const pageAnalysisMap = new Map(analysisResults.map(r => [r.url, r.analysis]));
  const pageAnalyses = pageResults.map(page => {
    if (page.error) return `### ${page.url}\n**Error:** ${page.error} — page could not be crawled.\n\n---\n`;
    return pageAnalysisMap.get(page.url) || `### ${page.url}\n**Analysis missing**\n\n---\n`;
  });

  // ── Phase 5: Generate summary ──────────────────────────────
  log('Phase 5: Generating summary...');
  let summary = '';
  try {
    const result = await llm.invoke([
      { role: 'system', content: 'You are an expert SEO auditor. Output only the markdown sections requested.' },
      { role: 'user', content: SUMMARY_PROMPT(site.name, pageAnalyses, sitemapData, competitiveData, config) },
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
    `## Pages Audited (${enrichedPages.length})`,
    ...enrichedPages.map(p => `- ${p.url}${p.error ? ' ⚠ ' + p.error : ''}${p.analytics?.gsc ? ` (${p.analytics.gsc.impressions} impressions, pos ${p.analytics.gsc.avgPosition?.toFixed(1)})` : ''}`),
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
    pagesAudited: enrichedPages.length,
    analyticsEnabled: enrichedPages.some(p => p.analytics?.gsc || p.analytics?.ga4),
    pagesAnalyzed: pageAnalyses.length,
  });

  return { content: `SEO audit complete. ${pageResults.length} pages audited. Report saved to .brad/findings/${filename}` };
}
