/**
 * Competitive Analysis Agent — deep research on competitors
 *
 * Searches for competitors, crawls their sites, compares positioning,
 * features, SEO, and messaging against our product.
 * Designed to run in the background.
 */

import { createBradAgent, runAgent } from '../core/agent.js';
import { crawlPage, crawlSite } from '../tools/web-crawler.js';
import { webSearch } from '../tools/search.js';
import { createFileTools } from '../tools/file-ops.js';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

const COMPETITIVE_PROMPT = (siteName, siteUrl, brandContext, config) => {
  const knownCompetitors = config?.brand?.competitors || [];
  const primaryKeywords = config?.brand?.keywords?.primary || [];
  const secondaryKeywords = config?.brand?.keywords?.secondary || [];
  const differentiators = config?.brand?.differentiators || [];

  return `
You are conducting a deep competitive analysis for ${siteName} (${siteUrl}).

## Our Product
${brandContext?.valueProposition || 'See brand context for details.'}

**Our Differentiators:**
${differentiators.map(d => `- ${d}`).join('\n')}

**Our Target Keywords:**
${[...primaryKeywords, ...secondaryKeywords].map(k => `- ${k}`).join('\n')}

${knownCompetitors.length > 0 ? `**Previously Identified Competitors:**\n${knownCompetitors.map(c => `- ${c}`).join('\n')}` : ''}

## Your Tasks

### Step 1: Discover Competitors
Search for our primary keywords to find who we're competing against:
${primaryKeywords.slice(0, 5).map(k => `- Search: "${k}"`).join('\n')}
- Search: "best ${primaryKeywords[0] || 'legal AI'} 2026"
- Search: "alternatives to ${siteName}"
- Search: "${siteName} vs"

For each search, record EVERY result — title, URL, and snippet. These are real market signals.

### Step 2: Identify Top Competitors
From the search results, identify the top 5-8 competitors that appear most frequently.
For each competitor, note:
- Company name and URL
- How many times they appeared across searches
- Which keywords they rank for

### Step 3: Deep-Dive Each Competitor
For each of the top 5 competitors, use **crawl_page** on their homepage to extract:
- Their title tag and meta description (how they position themselves)
- Their H1 and key headings (what they lead with)
- Their value proposition (from page content)
- Their pricing model (if visible)
- Their target audience
- Key features they emphasize
- Any claims they make (speed, accuracy, etc.)

### Step 4: Comparative Analysis
Build a comparison matrix across these dimensions:
- **Positioning**: How they describe themselves vs how we describe ourselves
- **Target Market**: Who they go after vs who we go after
- **Deployment Model**: Cloud vs on-premise vs hybrid
- **Key Features**: What they offer vs what we offer
- **Pricing**: How they price vs how we price (if visible)
- **SEO Strength**: Which keywords they dominate
- **Messaging**: What angle they lead with
- **Weaknesses**: Where they fall short (based on what's NOT on their site)

### Step 5: Strategic Recommendations
Based on the analysis:
- Where are we strongest compared to competitors?
- Where are we weakest or missing opportunities?
- What keywords do competitors rank for that we should target?
- What messaging angles are competitors NOT using that we could own?
- Which competitor is our biggest threat and why?

## Output

Save a comprehensive finding with filename "${todayStr()}-competitive-analysis.md" containing:

# Competitive Analysis — ${siteName} — ${todayStr()}

## Search Landscape
(For each keyword searched: what results came back, who appeared)

## Competitor Profiles
(For each competitor: full profile from crawl data)

### [Competitor Name] — [URL]
- **Positioning**: "[their title tag]" / "[their H1]"
- **Value Prop**: ...
- **Target Market**: ...
- **Deployment**: Cloud / On-Premise / Hybrid
- **Key Features**: ...
- **Pricing**: ...
- **SEO Keywords**: (from their meta tags and headings)
- **Strengths**: ...
- **Weaknesses**: ...

## Comparison Matrix
| Dimension | ${siteName} | Competitor 1 | Competitor 2 | ... |
|-----------|-------------|--------------|--------------|-----|
| ... | ... | ... | ... | ... |

## Strategic Recommendations
- **Our Advantages**: ...
- **Our Gaps**: ...
- **Keyword Opportunities**: ...
- **Messaging Opportunities**: ...
- **Biggest Threat**: ...

## Raw Search Data
(All search results preserved for reference)

CRITICAL RULES:
- Every competitor claim must come from an actual crawl or search result.
- Include the raw data (titles, descriptions, headings) so findings are verifiable.
- Do NOT use your training data knowledge of competitors — only what you find via tools.
- Be honest about our weaknesses, not just cheerleading.
`;
};

/**
 * Run competitive analysis
 * @param {BaseChatModel} llm
 * @param {Workspace} workspace
 * @param {object} options
 * @param {function} options.log - activity log callback
 */
export async function runCompetitiveAnalysis(llm, workspace, options = {}) {
  const log = options.log || (() => {});
  const config = await workspace.loadConfig();
  const site = config.sites[0];

  if (!site) {
    throw new Error('No site configured. Run: brad init --site <url>');
  }

  const brandContext = await workspace.loadBrandContext();
  const fileTools = createFileTools(workspace);
  const tools = [crawlPage, crawlSite, webSearch, ...fileTools];

  log(`Starting competitive analysis for ${site.name}...`);
  const agent = createBradAgent(llm, tools, { brandContext, config });

  const toolDescriptions = {
    crawl_site: (args) => `Crawling competitor: ${args.url}`,
    crawl_page: (args) => `Analyzing: ${args.url}`,
    web_search: (args) => `Searching: "${args.query}"`,
    save_finding: (args) => `Saving: ${args.filename}`,
  };

  const result = await runAgent(
    agent,
    COMPETITIVE_PROMPT(site.name, site.url, brandContext, config),
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
    action: 'competitive_analysis',
    site: site.url,
    date: todayStr(),
    toolCalls: result.toolCalls,
  });

  return result;
}
