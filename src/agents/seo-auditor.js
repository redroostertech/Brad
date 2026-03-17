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

  // Look for page templates in the site's views directory
  // Prefer lana-ai specific paths, fall back to any views/*/pages/
  const siteSlug = new URL(siteUrl).hostname.split('.')[0]; // e.g., "lanaai"
  const pageFiles = focus.filter(f => {
    if (!f.includes('/pages/') || !f.endsWith('.ejs') || f.includes(' copy')) return false;
    // Prefer product-specific view dirs (lana-ai, forge, etc.)
    // Skip generic views/pages/ which is a different product
    const dir = f.split('/pages/')[0];
    return dir !== 'views';
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
2. **Include the raw data** alongside your analysis. Show the actual title tag, actual meta description, actual heading text — not paraphrased versions.
3. **Do NOT invent competitors.** Only list competitors that appear in actual web search results. If a search returns no relevant competitors, say "No direct competitors found in search results."
4. **Do NOT invent metrics.** If you cannot measure something (like exact word count), say "estimated" or omit it. Never make up precise numbers.
5. **Label uncertainty.** If something is your inference rather than observed data, prefix it with "[Inference]".

## Audit Steps

### Step 1: Crawl Every Known Page
Crawl each of these pages individually using **crawl_page**. These are derived from the project's view templates — this is the definitive page list:

${derivePageUrls(siteUrl, config)}

You MUST call crawl_page on EVERY URL above. Do NOT skip any. Do NOT write "(repeat for each page)" — actually crawl each one and record the data.

### Step 2: Discover Additional Pages
After crawling the known pages, use **crawl_site** with URL "${siteUrl}" and maxPages 20 to follow internal links and find any pages NOT in the list above (e.g., blog posts, landing pages, unlisted pages).

For EACH page (from both steps), record from the crawl tool response:
- Exact title tag text (meta.title)
- Exact meta description (meta.description)
- Exact canonical URL (meta.canonical)
- Exact OG tags (meta.ogTitle, meta.ogDescription, meta.ogImage)
- All headings (level and text)
- Image count and how many are missing alt text
- Internal link count and external link count
- Body text length from the tool (bodyTextLength field)
- Any JSON-LD structured data found

### Step 3: Check Sitemap
- Crawl the sitemap
- Record total pages found
- List all URLs from the sitemap

### Step 4: Competitive Search (actual search results only)
- Search for 2-3 of our target keywords (e.g., "legal AI software", "on-premise AI law firm")
- Record the ACTUAL search results returned — title, URL, snippet
- Only name competitors that appear in these results

## Output Format

Save your audit as a finding with filename "${todayStr()}-seo-audit.md" containing:

\`\`\`markdown
# SEO Audit — ${siteName} — ${todayStr()}

## Pages Crawled
(list each URL you crawled)

## Page-by-Page Analysis

### [Page Name] — [URL]

**Raw Data:**
- Title: "[exact title from crawl]" (X chars)
- Meta Description: "[exact description from crawl]" (X chars)
- Canonical: [exact canonical URL]
- H1: "[exact H1 text]"
- All Headings: [list them with levels]
- Images: X total, Y missing alt text
- Internal Links: X | External Links: Y
- Body Text Length: X chars (from crawl data)
- OG Image: [present/missing]
- JSON-LD: [present/missing, what type]

**Issues Found:**
- [specific issue with specific fix]

(repeat for each page)

## Sitemap Analysis
- Sitemap URL: [actual URL]
- Total pages indexed: [number]
- Pages found: [list URLs]
- Missing pages: [any important pages NOT in sitemap]

## Competitive Search Results

### Search: "[exact query used]"
Results returned:
1. [Title] — [URL] — "[snippet]"
2. ...

### Search: "[exact query used]"
Results returned:
1. ...

**Competitive Observations:** (based ONLY on search results above)
- ...

## Issues Summary

### Critical (fix now)
- [ ] [Issue] — Evidence: [what crawl showed] — Fix: [specific action]

### Warnings (fix this week)
- [ ] [Issue] — Evidence: [what crawl showed] — Fix: [specific action]

### Opportunities
- [ ] [Opportunity] — Based on: [observed data or search results]
\`\`\`

Remember: if you didn't observe it in a tool call, don't report it.
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
