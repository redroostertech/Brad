/**
 * SEO Auditor Agent — runs daily SEO audits and saves actionable findings
 * Grounded in actual crawl data — no hallucination allowed
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

  // Build a slug from the site name: "Lana AI" → "lana-ai"
  const siteSlug = siteName.toLowerCase().replace(/\s+/g, '-');

  // Only include pages from the product's own views directory
  // e.g., views/lana-ai/pages/ for "Lana AI"
  const seen = new Set();
  const pageFiles = focus.filter(f => {
    if (!f.includes('/pages/') || !f.endsWith('.ejs') || f.includes(' copy')) return false;
    // Must be in the product's view dir (views/lana-ai/) not views/pages/ or views/forge/
    const dir = f.split('/pages/')[0];
    if (siteSlug && !dir.includes(siteSlug)) return false;
    if (dir === 'views') return false;
    // Deduplicate
    if (seen.has(f)) return false;
    seen.add(f);
    return true;
  });

  if (pageFiles.length === 0) {
    return '- Try common paths: /features, /about, /security, /product, /contact, /demo, /pricing, /edge, /professional, /enterprise';
  }

  const skipPages = ['404', '500', 'error', 'oauth-redirect', 'oauth-error', 'home-2', 'landing'];

  return pageFiles.map(f => {
    // views/lana-ai/pages/features.ejs → /features
    const pageName = f.split('/').pop().replace('.ejs', '').replace(/_/g, '-');
    if (skipPages.includes(pageName)) return null;
    // "home" → root
    if (pageName === 'home') return `- ${siteUrl}/`;
    return `- ${siteUrl}/${pageName}`;
  }).filter(Boolean).join('\n');
}

const AUDIT_PROMPT = (siteUrl, siteName, brandContext, config) => `
Run a data-driven SEO audit on ${siteUrl} (${siteName}).

${brandContext ? `## Known Brand Context\n${JSON.stringify(brandContext, null, 2)}` : ''}

## CRITICAL RULES

1. **ONLY report what you actually observe from crawl data.** Every claim must trace back to a specific tool call result.
2. **Include the raw data** alongside your analysis — exact title tags, meta descriptions, headings. Not paraphrased.
3. **Do NOT invent competitors.** Only list competitors from actual search results.
4. **Do NOT invent metrics.** If you can't measure it, say "estimated" or omit it.
5. **NEVER write "(repeat for each page)" or any shortcut.** You must write the full analysis for EVERY page.
6. **VERIFY your work.** After writing the report, count the pages in your output and compare to the page list. If any are missing, add them.

## Agentic Workflow — Plan, Execute, Verify

### PLAN: These are the pages you will audit
${derivePageUrls(siteUrl, config)}

Total expected: count the URLs above. Your final report MUST have this exact count of page analyses.

### EXECUTE Phase 1: Crawl every page
Call **crawl_page** on EVERY URL listed above. No exceptions. No skipping.

### EXECUTE Phase 2: Discover additional pages
Use **crawl_site** with URL "${siteUrl}" and maxPages 20 to find unlisted pages.

### EXECUTE Phase 3: Check sitemap
Use **crawl_sitemap** on ${siteUrl}.

### EXECUTE Phase 4: Competitive search
Search for 2-3 target keywords. Record actual results only.

### EXECUTE Phase 5: Write the full report
Save finding as "${todayStr()}-seo-audit.md".

For EACH page, write this exact block (no shortcuts):

### [Page Name] — [URL]
**Raw Data:**
- Title: "[exact from crawl]" (X chars)
- Meta Description: "[exact from crawl]" (X chars)
- Canonical: [exact URL]
- H1: "[exact text]"
- Headings: [list all with levels]
- Images: X total, Y missing alt
- Links: X internal, Y external
- Body Length: X chars
- OG Image: present/missing
- JSON-LD: present/missing

**Issues:**
- [issue + fix]

YOU MUST WRITE THIS BLOCK FOR EVERY SINGLE PAGE. Not 3 pages. Not 5 pages. ALL of them.

After the page analyses, include:
- Sitemap Analysis (URL, pages found, missing pages)
- Competitive Search Results (exact queries and results)
- Issues Summary (Critical, Warnings, Opportunities with evidence)

### VERIFY: Self-check before saving
Before you call save_finding, count the "### [Page Name]" sections in your report.
- Does the count match the number of pages you crawled?
- Is every URL from the plan represented?
- If ANY page is missing, add it NOW before saving.

This verification step is mandatory. Do not save until all pages are accounted for.
`;

export async function runSEOAudit(llm, workspace, options = {}) {
  const log = options.log || (() => {});
  const config = await workspace.loadConfig();
  const site = config.sites[0];

  if (!site) {
    throw new Error('No site configured. Run: brad init --site <url>');
  }

  const brandContext = await workspace.loadBrandContext();
  const fileTools = createFileTools(workspace);
  const tools = [crawlPage, crawlSitemap, crawlSite, webSearch, ...fileTools];

  log(`Auditing ${site.url}...`);
  const agent = createBradAgent(llm, tools, { brandContext, config });

  const toolDescriptions = {
    crawl_site: (args) => `Crawling site: ${args.url} (max ${args.maxPages || 10} pages)`,
    crawl_page: (args) => `Crawling page: ${args.url}`,
    crawl_sitemap: (args) => `Checking sitemap: ${args.url}`,
    web_search: (args) => `Searching: "${args.query}"`,
    read_project_file: (args) => `Reading: ${args.path}`,
    save_finding: (args) => `Saving: ${args.filename}`,
  };

  const result = await runAgent(
    agent,
    AUDIT_PROMPT(site.url, site.name, brandContext, config),
    {
      onToolCall: (name, args) => {
        const desc = toolDescriptions[name];
        log(desc ? desc(args) : `Calling: ${name}`);
      },
      onToolResult: (name) => {
        log(`  Done: ${name}`);
      },
    }
  );

  await workspace.appendHistory({
    action: 'seo_audit',
    site: site.url,
    date: todayStr(),
    toolCalls: result.toolCalls,
  });

  return result;
}
