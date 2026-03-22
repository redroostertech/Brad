# Brad — Testing Matrix

> Last updated: 2026-03-22

## Command Testing

| Feature | Status | Notes |
|---------|--------|-------|
| `brad init` (basic) | **Passed** | Workspace creation, config skeleton |
| `brad init` (full analysis) | **Passed** | LLM ran, config populated with focus paths, keywords, platforms |
| `brad init --focus` | **Passed** | Focus paths scoped correctly |
| `brad init` activity log | **Not tested** | Needs cleanse + re-init to see timestamped output |
| `brad init` double-ESC abort | **Not tested** | Code in place, untested |
| `brad analyze` | **Passed** | Worked during init |
| `brad audit` | **Passed (A)** | 13 pages, per-page deep analysis, parallel crawling + LLM |
| `brad audit` GA4 integration | **Passed** | 11 pages enriched with real traffic data, path prefix matching |
| `brad audit` GSC integration | **Partial** | API connects, 0 rows (property needs 24-48h to process) |
| `brad audit` keyword coverage | **Passed** | Full-body matching, partial keyword matching |
| `brad audit` per-page analysis | **Passed** | 7 sections per page: title, meta, headings, keywords, links, technical, suggestions |
| `brad audit` traffic analysis | **Passed** | GA4 data in report: page views, bounce rate, session duration, traffic sources |
| `brad compete` | **Passed** | 4 competitors crawled, profiles + comparison matrix + recommendations |
| `brad compete` (config seeding) | **Not tested** | New: searches for config competitors + supplements from known list |
| `brad compete --bg` | **Not tested** | Background fork untested |
| `brad scout` | **Passed (early)** | Worked but needs re-test with activity log + abort |
| `brad keywords` | **Passed** | 130 autocomplete keywords found, saved to findings |
| `brad keywords` PAA/related | **Failed** | 0 results — Google blocking SERP scraper |
| `brad update` | **Passed** | No-upstream edge case handled |
| `brad status` | **Passed** | |
| `brad config` | **Passed** | |
| `brad findings` (selector) | **Not tested** | Interactive arrow-key selector |
| `brad read` | **Passed** | |
| `brad cleanse` | **Passed** | Yes/no confirmation |
| `brad help` | **Passed** | Alphabetized, all commands present |
| `brad` interactive mode | **Not tested** | getLLM() lazy loading, free-form messages |

## Infrastructure Testing

| Feature | Status | Notes |
|---------|--------|-------|
| Banner on every command | **Passed** | preAction hook, red/yellow block letters |
| Double-ESC abort | **Passed** | Works on audit, init, compete, scout |
| Activity log (timestamps) | **Passed** | All commands use createLogger() |
| MaxListeners fix | **Passed** | EventEmitter.defaultMaxListeners=50 |
| `install.sh` | **Not tested** | Never run |
| `setup.sh` | **Not tested** | Never run |
| `/brad` Claude Code skill | **Not tested** | Skill file exists, not invoked |

## Provider Testing

| Provider | Status | Notes |
|----------|--------|-------|
| OpenAI (GPT-4o) | **Passed** | Primary provider, all testing done with this |
| Anthropic (Claude) | **Not tested** | |
| LANA (local llama.cpp) | **Not tested** | |
| Ollama (local) | **Not tested** | |

## Google API Integration

| Integration | Status | Notes |
|-------------|--------|-------|
| GA4 Data API | **Passed** | 19 page rows, path prefix matching (/lana-ai/) works |
| GA4 traffic sources | **Passed** | organic/direct/referral/social per page |
| GA4 in audit report | **Passed** | Traffic & Engagement section per page |
| GSC API | **Connected** | 0 rows — property brand new, needs 24-48h |
| GSC in audit report | **Not tested** | No data available yet |
| `GOOGLE_APPLICATION_CREDENTIALS` | **Configured** | Firebase service account with Viewer/Full access |
| GA4 property ID | **Configured** | 503897921 |
| GSC site URL | **Configured** | sc-domain:lanaai.io |

## Report Quality

| Report | Grade | Key Metrics |
|--------|-------|-------------|
| SEO Audit | **A** | 13 pages, 66KB, 980 lines, 11 with GA4 data, per-page 7-section analysis |
| Competitive Analysis | **A-** | 4 competitors crawled + profiled, comparison matrix, strategic recs |
| Keyword Research | **B+** | 130 autocomplete keywords, 0 PAA, 0 related searches |
| Brand Analysis | **B+** | Auto-generated during init, config populated |

## Known Issues

| Issue | Severity | Description |
|-------|----------|-------------|
| PAA/Related scraper broken | Medium | Google blocks SERP scraping — 0 results from People Also Ask and Related Searches |
| GSC no data | Low | Brand new property, needs time to accumulate — will resolve automatically |
| Competitor names from search titles | Low | "9 Best Legal AI Tools..." instead of "Spellbook" — partially fixed with crawl title fallback |
| "Lana AI vs" returns patio results | Low | Fixed: now searches "Lana AI legal AI vs" |
| Keywords not integrated into audit | Enhancement | Audit uses config keywords only, doesn't read keyword research findings |

## Pending Enhancements

| Enhancement | Priority | Description |
|-------------|----------|-------------|
| Feed keyword research into audit | High | Audit should check coverage against discovered autocomplete keywords |
| Keyword research JSON output | Medium | Save structured JSON alongside markdown for tooling integration |
| Fix PAA/related scraper | Medium | Debug cheerio selectors or switch to Bing/DuckDuckGo |
| Competitor keyword gap analysis | Medium | Cross-reference competitor keywords with our coverage |
| Google Ads Keyword Planner | Low | Search volume data for discovered keywords |
| Multiple provider testing | Low | Verify anthropic, lana, ollama providers work |

## Architecture Decisions Log

| Decision | Rationale |
|----------|-----------|
| Node.js crawls, LLM analyzes | LLM skips work when asked to both fetch and analyze. Separating concerns solved the "lazy LLM" problem. |
| Per-page LLM calls | Single LLM call for 13+ pages → truncation. One call per page → every page analyzed. |
| Parallel batches of 4 | Fully parallel hits API rate limits. Sequential is too slow. Batches of 4 balance speed and reliability. |
| GA4 path prefix matching | lanaai.io → redroostertec.com/lana-ai rewrite means GA4 paths have /lana-ai/ prefix. Enricher tries both paths. |
| Report saved by Node.js | LLM can't be trusted to call save_finding. Node.js always saves after assembly. |
| Config competitors seeded into compete | Search alone misses known competitors. Config list supplements search discovery. |
| Standard Chrome User-Agent | Custom "Brad-CMO/0.1" got 403'd by bot protection. Chrome UA works everywhere. |
