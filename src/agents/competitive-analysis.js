/**
 * Competitive Analysis Agent — deep research on competitors
 *
 * Architecture: Same as SEO auditor — Node.js does the heavy lifting,
 * LLM analyzes the data. No reliance on LLM to crawl or save.
 *
 * Phase 1: Search for competitors (Node.js, parallel)
 * Phase 2: Identify top competitors from search results (LLM)
 * Phase 3: Crawl competitor homepages (Node.js, parallel)
 * Phase 4: Analyze each competitor (LLM, batched)
 * Phase 5: Generate comparative summary (LLM)
 * Phase 6: Assemble and save report (Node.js)
 */

import { createFileTools } from '../tools/file-ops.js';
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ── Phase 1: Search ──────────────────────────────────────────────

async function searchKeyword(query, log) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    });
    const html = await response.text();
    const $ = cheerio.load(html);
    const results = [];
    $('.result').each((_, el) => {
      if (results.length >= 7) return;
      const title = $(el).find('.result__a').text().trim();
      const snippet = $(el).find('.result__snippet').text().trim();
      const resultUrl = $(el).find('.result__url').text().trim();
      if (title) results.push({ title, snippet, url: resultUrl, query });
    });
    return results;
  } catch (err) {
    log(`  ⚠ Search failed for "${query}": ${err.message}`);
    return [];
  }
}

// ── Phase 2: Extract competitors from search results ─────────────

function identifyCompetitors(allResults, ownSiteName) {
  const domainCount = new Map();
  const domainInfo = new Map();

  for (const r of allResults) {
    // Extract domain from URL
    let domain = r.url;
    try {
      domain = new URL(r.url.startsWith('http') ? r.url : `https://${r.url}`).hostname.replace('www.', '');
    } catch {
      domain = r.url.split('/')[0].replace('www.', '');
    }

    // Skip list sites, review aggregators, and our own site
    const skipDomains = ['g2.com', 'sourceforge.net', 'slashdot.org', 'capterra.com',
      'trustradius.com', 'getapp.com', 'softwareadvice.com', 'forbes.com',
      'techcrunch.com', 'wikipedia.org', 'youtube.com', 'reddit.com',
      'marthastewart.com', 'thespruce.com', 'cleverpatio.com',
      'ironcladapp.com/resources', 'attorneyandpractice.com', 'aimultiple.com'];
    if (skipDomains.some(s => domain.includes(s))) continue;
    if (domain.includes(ownSiteName.toLowerCase().replace(/\s+/g, ''))) continue;

    domainCount.set(domain, (domainCount.get(domain) || 0) + 1);
    if (!domainInfo.has(domain)) {
      domainInfo.set(domain, { domain, name: r.title.split(' - ')[0].split(' | ')[0].trim(), queries: [] });
    }
    domainInfo.get(domain).queries.push(r.query);
  }

  // Sort by frequency, take top 5
  return [...domainCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => ({
      ...domainInfo.get(domain),
      appearances: count,
      crawlUrl: `https://${domain}`,
    }));
}

// ── Phase 3: Crawl competitor pages ──────────────────────────────

async function crawlCompetitor(competitor, log) {
  log(`  Crawling: ${competitor.crawlUrl}`);
  try {
    const response = await fetch(competitor.crawlUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      log(`  ⚠ ${competitor.domain} returned HTTP ${response.status}`);
      return { ...competitor, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    $('script, style, noscript, iframe').remove();

    const title = $('title').text().trim();
    const description = $('meta[name="description"]').attr('content') || '';
    const h1 = $('h1').first().text().trim();

    const headings = [];
    $('h1, h2, h3').each((_, el) => {
      if (headings.length < 20) {
        headings.push({ level: el.tagName, text: $(el).text().trim().substring(0, 150) });
      }
    });

    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

    log(`  ✓ ${competitor.domain} (${title.substring(0, 50)}...)`);
    return {
      ...competitor,
      crawl: {
        title,
        description,
        h1,
        headings,
        bodyTextPreview: bodyText.substring(0, 3000),
        bodyTextLength: bodyText.length,
      },
    };
  } catch (err) {
    log(`  ⚠ ${competitor.domain}: ${err.message}`);
    return { ...competitor, error: err.message };
  }
}

// ── Phase 4: Per-competitor LLM analysis ─────────────────────────

const COMPETITOR_PROMPT = (competitor, ourBrand, differentiators) => `
Analyze this competitor based on their ACTUAL homepage data. Be specific and grounded.

## Our Product
- Name: ${ourBrand.name}
- Differentiators: ${differentiators.join(' | ')}

## Competitor: ${competitor.name} (${competitor.domain})
- Found in searches for: ${[...new Set(competitor.queries)].join(', ')}
- Appearances across keyword searches: ${competitor.appearances}

## Their Homepage Data (from crawl)
- Title: "${competitor.crawl.title}"
- Meta Description: "${competitor.crawl.description}"
- H1: "${competitor.crawl.h1}"
- Headings: ${JSON.stringify(competitor.crawl.headings.map(h => h.level + ': ' + h.text))}
- Body preview: ${competitor.crawl.bodyTextPreview.substring(0, 2000)}

## Write ONLY this analysis block:

### ${competitor.name} — ${competitor.crawlUrl}

**Positioning:** [How they describe themselves based on title, H1, and body. Quote their exact words.]
**Target Market:** [Who they're going after based on their messaging]
**Deployment Model:** [Cloud / On-Premise / Hybrid — based on what their page says]
**Key Features:** [List features mentioned in their headings and body]
**Pricing:** [If mentioned on homepage, include it. If not, say "Not visible on homepage"]
**SEO Keywords:** [What keywords their title, H1, and headings target]
**Strengths vs Us:** [Where they appear stronger based on their messaging]
**Weaknesses vs Us:** [Where they fall short or don't address what we do — based on what's NOT on their page]

---
`;

// ── Phase 5: Summary prompt ──────────────────────────────────────

const SUMMARY_PROMPT = (siteName, competitorAnalyses, searchData, differentiators) => `
You have analyzed ${competitorAnalyses.length} competitors for ${siteName}. Write the summary sections.

## Our Differentiators
${differentiators.map(d => '- ' + d).join('\n')}

## Raw Search Data
${searchData}

## Competitor Analyses Already Written
${competitorAnalyses.join('\n\n')}

## Write ONLY these sections:

## Comparison Matrix
| Dimension | ${siteName} | [Competitor 1] | [Competitor 2] | ... |
|-----------|-------------|----------------|----------------|-----|
| Positioning | ... | ... | ... | ... |
| Target Market | ... | ... | ... | ... |
| Deployment | On-Premise | ... | ... | ... |
| Key Differentiator | ... | ... | ... | ... |

## Strategic Recommendations
- **Our Biggest Advantage:** [What we have that NO competitor offers]
- **Our Biggest Gap:** [Where competitors are stronger — be honest]
- **Keyword Opportunities:** [Keywords competitors rank for that we should target]
- **Content to Create:** [3-5 specific content pieces based on competitive gaps]
- **Positioning Strategy:** [How to differentiate in messaging based on competitive landscape]
`;

// ── Main runner ──────────────────────────────────────────────────

export async function runCompetitiveAnalysis(llm, workspace, options = {}) {
  const log = options.log || (() => {});
  const config = await workspace.loadConfig();
  const site = config.sites[0];

  if (!site) {
    throw new Error('No site configured. Run: brad init --site <url>');
  }

  const brandContext = await workspace.loadBrandContext();
  const differentiators = config?.brand?.differentiators || [];
  const primaryKeywords = config?.brand?.keywords?.primary || ['legal AI software'];
  const knownCompetitors = config?.brand?.competitors || [];

  // ── Phase 1: Search for competitors (parallel) ─────────────
  const searchQueries = [
    ...primaryKeywords.slice(0, 5),
    `best ${primaryKeywords[0]} 2026`,
    `alternatives to ${site.name}`,
    `${site.name} legal AI vs`,
  ];

  // Also search for known competitors from config
  for (const comp of knownCompetitors.slice(0, 5)) {
    const name = comp.replace(/\s*\(.*\)/, '').trim(); // Strip "(Thomson Reuters)" etc.
    searchQueries.push(`${name} legal AI`);
  }

  log(`Phase 1: Searching ${searchQueries.length} queries in parallel...`);
  const allResults = (await Promise.all(
    searchQueries.map(q => {
      log(`  Searching: "${q}"`);
      return searchKeyword(q, log);
    })
  )).flat();
  log(`  Found ${allResults.length} total results`);

  // ── Phase 2: Identify top competitors (Node.js) ────────────
  log('Phase 2: Identifying top competitors from search results + config...');
  const competitors = identifyCompetitors(allResults, site.name);

  // Ensure known competitors from config are included even if not found in search
  for (const comp of knownCompetitors) {
    const name = comp.replace(/\s*\(.*\)/, '').trim();
    const nameLower = name.toLowerCase();
    const alreadyFound = competitors.some(c =>
      c.domain.includes(nameLower.replace(/\s+/g, '')) || c.name.toLowerCase().includes(nameLower)
    );
    if (!alreadyFound && competitors.length < 8) {
      // Try to derive a URL from the name
      const slug = name.toLowerCase().replace(/\s+/g, '');
      competitors.push({
        domain: `${slug}.com`,
        name: name,
        queries: ['config: known competitor'],
        appearances: 0,
        crawlUrl: `https://${slug}.com`,
      });
    }
  }
  log(`  Top ${competitors.length} competitors: ${competitors.map(c => c.domain).join(', ')}`);

  if (competitors.length === 0) {
    const report = `# Competitive Analysis — ${site.name} — ${todayStr()}\n\nNo competitors identified from search results.`;
    const filename = `${todayStr()}-competitive-analysis.md`;
    await workspace.saveFinding(filename, report);
    return { content: 'No competitors found in search results.' };
  }

  // ── Phase 3: Crawl competitor homepages (parallel) ─────────
  log(`Phase 3: Crawling ${competitors.length} competitor homepages...`);
  const crawledCompetitors = await Promise.all(
    competitors.map(c => crawlCompetitor(c, log))
  );
  const successful = crawledCompetitors.filter(c => !c.error && c.crawl);
  log(`  Crawled ${successful.length}/${competitors.length} successfully`);

  // ── Phase 4: Analyze each competitor via LLM (parallel) ────
  log(`Phase 4: Analyzing ${successful.length} competitors via LLM...`);
  const competitorAnalyses = await Promise.all(
    successful.map(async (competitor) => {
      log(`  Analyzing: ${competitor.domain}`);
      try {
        const result = await llm.invoke([
          { role: 'system', content: 'You are a competitive intelligence analyst. Output only the markdown block requested. No preamble.' },
          { role: 'user', content: COMPETITOR_PROMPT(competitor, { name: site.name }, differentiators) },
        ]);
        const content = typeof result.content === 'string' ? result.content : result.content?.[0]?.text || '';
        log(`  ✓ Done: ${competitor.domain}`);
        return content.trim();
      } catch (err) {
        log(`  ⚠ Analysis failed for ${competitor.domain}: ${err.message}`);
        return `### ${competitor.name} — ${competitor.crawlUrl}\n**Analysis failed:** ${err.message}\n\n---`;
      }
    })
  );

  // ── Phase 5: Generate summary via LLM ──────────────────────
  log('Phase 5: Generating comparative summary...');
  let summary = '';
  const searchData = searchQueries.map((q, i) => {
    const results = allResults.filter(r => r.query === q);
    return `### Search: "${q}"\n${results.map((r, j) => `${j + 1}. ${r.title} — ${r.url}`).join('\n')}`;
  }).join('\n\n');

  try {
    const result = await llm.invoke([
      { role: 'system', content: 'You are a competitive intelligence analyst. Output only the markdown sections requested.' },
      { role: 'user', content: SUMMARY_PROMPT(site.name, competitorAnalyses, searchData, differentiators) },
    ]);
    summary = typeof result.content === 'string' ? result.content : result.content?.[0]?.text || '';
  } catch (err) {
    log(`  Summary failed: ${err.message}`);
    summary = '## Summary\nFailed to generate comparative summary.';
  }

  // ── Phase 6: Assemble and save report (Node.js) ────────────
  log('Phase 6: Assembling report...');
  const report = [
    `# Competitive Analysis — ${site.name} — ${todayStr()}`,
    '',
    `## Competitors Analyzed (${successful.length})`,
    ...successful.map(c => {
      // Use crawled title for company name if available (cleaner than search result title)
      const displayName = c.crawl?.title?.split(' - ')[0]?.split(' | ')[0]?.trim() || c.name;
      const source = c.appearances > 0 ? `found in ${c.appearances} searches` : 'from config';
      return `- **${displayName}** — ${c.crawlUrl} (${source})`;
    }),
    ...crawledCompetitors.filter(c => c.error).map(c => `- ⚠ ${c.domain} — failed: ${c.error}`),
    '',
    '## Search Landscape',
    '',
    searchData,
    '',
    '## Competitor Profiles',
    '',
    ...competitorAnalyses,
    '',
    summary,
  ].join('\n');

  const filename = `${todayStr()}-competitive-analysis.md`;
  await workspace.saveFinding(filename, report);
  log(`✓ Report saved: ${filename} (${successful.length} competitors, ${report.length} chars)`);

  await workspace.appendHistory({
    action: 'competitive_analysis',
    site: site.url,
    date: todayStr(),
    competitorsAnalyzed: successful.length,
  });

  return { content: `Competitive analysis complete. ${successful.length} competitors analyzed. Report saved to .brad/findings/${filename}` };
}
