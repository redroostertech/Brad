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

For EACH page, write this FULL analysis block. Every section is required for every page:

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

**Title Tag Analysis:**
- Length: Is it within 50-60 chars? If too long, what gets truncated in SERPs?
- Keyword presence: Does it contain any of our primary keywords (${config?.brand?.keywords?.primary?.slice(0, 3).join(', ') || 'legal AI, on-premise AI, law firm AI'})? If not, suggest a rewrite.
- Compelling: Would a lawyer click this in search results? Suggest improvements.
- Branding: Is the brand name positioned correctly (end of title for inner pages)?

**Meta Description Analysis:**
- Length: Is it within 150-160 chars? Too short wastes SERP real estate, too long gets truncated.
- Call to action: Does it compel a click? Does it include a benefit or differentiator?
- Keyword presence: Does it contain target keywords naturally?
- Suggested rewrite: Provide an improved version if the current one is weak.

**Heading Structure Analysis:**
- Is there exactly one H1? Does it match the page's intent?
- Does the H1 contain a target keyword?
- Is the hierarchy clean (H1 → H2 → H3, no skips)?
- Do the H2s represent clear content sections?
- Are there any heading-level issues (e.g., H3 used for styling instead of structure)?

**Content Assessment:**
- Depth: Is the body text substantive (>1000 chars for a real page) or thin?
- Keyword coverage: Based on the body text preview, are target keywords present naturally?
- Content gaps: What topics should this page cover that it doesn't seem to? (Compare to what competitors cover for similar pages.)
- Readability: Are headings descriptive enough for scan-reading?

**Internal Linking:**
- Link count assessment: Is this page well-connected to the rest of the site?
- Missing links: What other pages on the site should this page link to?
- Anchor text: Are the internal links using descriptive anchor text or generic "click here"?

**Technical Issues:**
- Canonical: Does it match the expected URL? (Watch for www vs non-www mismatches)
- OG tags: Complete or missing pieces?
- JSON-LD: What schema type should this page have? (e.g., Organization for homepage, Service for product pages, FAQPage for pages with Q&A sections)
- Mobile: Any signals of mobile issues from the markup?

**Specific Suggestions:**
1. [Actionable suggestion with explanation of WHY and expected IMPACT]
2. [Another suggestion]
3. [Another suggestion]

---

YOU MUST WRITE THIS FULL BLOCK FOR EVERY SINGLE PAGE. Not 3 pages. ALL of them. Each page gets unique, specific analysis — not copy-pasted generic advice.

After ALL page analyses, include:

## Sitemap Analysis
- Sitemap URL, pages found, missing pages
- Is the sitemap being served for the correct domain?

## Competitive Search Results
- Exact queries and full results
- What competitors are doing that we aren't

## Cross-Site Issues
Patterns found across multiple pages (e.g., "JSON-LD missing on all pages" is ONE cross-site issue, not repeated per page)

## Priority Action Plan
### Critical (fix this week)
- [ ] [Issue] — **Why it matters:** [explain the SEO impact] — **Fix:** [specific steps] — **Pages affected:** [list]

### Important (fix this month)
- [ ] [Issue] — **Why it matters:** [explanation] — **Fix:** [steps] — **Pages affected:** [list]

### Opportunities (plan for next quarter)
- [ ] [Opportunity] — **Why it matters:** [explanation] — **How:** [approach] — **Expected impact:** [what this could improve]

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
