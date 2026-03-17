<p align="center">
  <img src="logo.png" alt="Brad" width="120" />
</p>

<h1 align="center">Brad</h1>

<p align="center"><strong>B.R.A.D. — Brand Reach Automation & Distribution</strong></p>

Your autonomous AI CMO. Brad lives in your project directory, crawls your website, audits your SEO, scouts Reddit and Hacker News for engagement opportunities, researches competitors, and drafts content — all from the terminal.

---

## Install

### Prerequisites

- **Node.js** 20+
- **An LLM API key** — OpenAI, Anthropic, or a local LANA/Ollama instance

### Quick Install

```bash
git clone https://github.com/redroostertechnologies/brad.git
cd brad
./install.sh
```

The install script checks prerequisites, installs dependencies, and links `brad` as a global command.

### Manual Install

```bash
git clone https://github.com/redroostertechnologies/brad.git
cd brad
npm install
npm link
```

Verify:

```bash
brad --version
```

### Update

```bash
brad update
```

Fetches the latest version, installs new dependencies, and re-links the command. If you have local changes, Brad will tell you how to resolve them.

---

## Quick Start

### 1. Set your API key

```bash
export OPENAI_API_KEY=sk-your-key
```

### 2. Initialize in your project

```bash
cd ~/your-project
brad init --site https://yoursite.com --name "Your Product"
```

Brad will scan your project, crawl your live website, search for competitors, and build the complete config automatically.

### 3. Run commands

```bash
brad audit       # SEO audit
brad compete     # Competitive analysis
brad scout       # Reddit opportunities
brad             # Interactive mode
```

---

## Setup Script

For a guided setup that includes installing the Claude Code skill:

```bash
# From Brad's install directory
./setup.sh --site https://yoursite.com --name "Your Product"

# With options
./setup.sh --site https://yoursite.com --name "Your Product" \
  --provider anthropic \
  --focus "views/my-product,docs/seo,data" \
  --local http://localhost:3000

# Install Claude Code skill only
./setup.sh --skill
```

### Setup Script Flags

| Flag | Description |
|------|-------------|
| `--site <url>` | Your website URL (required) |
| `--name <name>` | Product/company name (required) |
| `--provider <name>` | LLM provider (default: openai) |
| `--focus <paths>` | Comma-separated paths to focus on |
| `--local <url>` | Local dev URL |
| `--skill` | Install Claude Code skill only |

---

## Commands

### Setup

#### `brad init`

Initialize Brad workspace and build the full config.

```bash
brad init --site <url> --name <name> [options]
```

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--site <url>` | `-s` | Website URL to crawl and analyze | Required |
| `--name <name>` | `-n` | Product or company name | `"My Product"` |
| `--provider <name>` | `-p` | LLM provider: `openai`, `anthropic`, `lana`, `ollama` | `openai` |
| `--local <url>` | `-l` | Local development URL | None |
| `--focus <paths>` | `-f` | Comma-separated directories/files to scan | Full project |
| `--ga4 <id>` | | Google Analytics 4 property ID | Auto-detected from .env |
| `--skip-analysis` | | Create workspace only, skip LLM analysis | `false` |

**What init does:**
1. Creates `.brad/` workspace directory
2. Scans `.env` files for analytics IDs
3. Walks focus paths for templates, docs, data files
4. Crawls your live website (follows internal links)
5. Searches the web for brand and competitors
6. Builds `config.json` (brand, keywords, platforms, leads)
7. Saves `brand-context.json` for agent system prompts

**Focus paths** — For large or multi-product repos, tell Brad where to look:

```bash
brad init --site https://lanaai.io --name "Lana AI" \
  --focus "views/lana-ai,routes/lana-ai.js,docs/seo,data"
```

Brad will only scan those directories instead of the entire project.

---

### Analysis

#### `brad analyze`

Re-crawl your website and refresh the brand context. Use after major site changes.

```bash
brad analyze
```

#### `brad audit`

Full SEO audit with page-by-page breakdown. Crawls every page, checks meta tags, headings, content depth, keywords, and competitor rankings.

```bash
brad audit
```

Results saved to `.brad/findings/YYYY-MM-DD-seo-audit.md`.

#### `brad compete`

Deep competitive analysis. Searches for your keywords, discovers competitors, crawls their sites, compares positioning, and produces a strategic report.

```bash
brad compete           # Foreground with live activity log
brad compete --bg      # Run in background
```

| Flag | Description |
|------|-------------|
| `--bg` | Run in background (detached process) |

Results saved to `.brad/findings/YYYY-MM-DD-competitive-analysis.md`.

#### `brad scout`

Scout Reddit for relevant discussions and draft authentic engagement replies.

```bash
brad scout
```

Results saved to `.brad/findings/` and `.brad/content/reddit/`.

---

### View Results

#### `brad config`

Display the current workspace configuration.

```bash
brad config
```

#### `brad findings`

List all saved findings and reports.

```bash
brad findings
```

#### `brad read <filename>`

Read a specific finding in full.

```bash
brad read 2026-03-17-seo-audit.md
```

#### `brad status`

Show workspace overview — site, provider, brand context status, findings count.

```bash
brad status
```

---

### Maintenance

#### `brad cleanse`

Remove all Brad data (`.brad/`) from the current project. Requires typing `yes` to confirm. No project files are touched.

```bash
brad cleanse
```

#### `brad update`

Pull the latest Brad version, install dependencies, and re-link the global command.

```bash
brad update
```

#### `brad help`

Show all commands with descriptions.

```bash
brad help
```

---

### Interactive Mode

Launch Brad's interactive REPL. All commands above work inside interactive mode, plus you can ask Brad anything in natural language.

```bash
brad
```

```
  brad> What's our Reddit situation?
  brad> audit
  brad> Read me the latest finding
  brad> What keywords should we target for estate planning lawyers?
```

---

## Claude Code Skill

Brad includes a `/brad` skill for Claude Code that scans your repo for deeper config enrichment. Claude Code is better at reading project internals (templates, routes, architecture) while Brad is better at crawling live sites and searching the web.

### Install the Skill

**Option A:** Use the setup script:

```bash
cd ~/your-project
/path/to/brad/setup.sh --skill
```

**Option B:** Copy manually:

```bash
mkdir -p .claude/skills/brad
cp /path/to/brad/skill/SKILL.md .claude/skills/brad/SKILL.md
```

### Use the Skill

In Claude Code, inside your project:

```
/brad setup     # Full scan — builds complete .brad/config.json
/brad refresh   # Re-scan and update existing config
/brad show      # Display current config summary
```

---

## Configuration

### Environment Variables

#### LLM Providers

| Variable | Required For | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | `--provider openai` | None (required) |
| `OPENAI_MODEL` | Override OpenAI model | `gpt-4o` |
| `ANTHROPIC_API_KEY` | `--provider anthropic` | None (required) |
| `ANTHROPIC_MODEL` | Override Anthropic model | `claude-sonnet-4-20250514` |
| `LANA_API_URL` | `--provider lana` | `http://localhost:8080/api/v1` |
| `LANA_API_TOKEN` | `--provider lana` | `local` |
| `LANA_MODEL` | Override LANA model | `lana-default` |
| `OLLAMA_URL` | `--provider ollama` | `http://localhost:11434` |
| `OLLAMA_MODEL` | Override Ollama model | `llama3.1:8b` |

#### Agent Behavior

| Variable | Description | Default |
|----------|------------|---------|
| `BRAD_LLM_PROVIDER` | Default LLM provider | `openai` |
| `BRAD_APPROVAL_MODE` | `require` or `auto` | `require` |
| `BRAD_LOG_LEVEL` | `silent`, `normal`, `verbose` | `normal` |

#### Google APIs (enriches SEO audits with real data)

| Variable | Description | Example |
|----------|-------------|---------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON key | `/path/to/service-account.json` |
| `GSC_SITE_URL` | Site URL as registered in Search Console | `https://lanaai.io/` or `sc-domain:lanaai.io` |
| `GA4_PROPERTY_ID` | **Numeric** GA4 property ID (not `G-XXXXXXX`) | `123456789` |

**Setup steps:**

1. **Service account**: Use an existing one (e.g., Firebase) or create one in [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. **Enable APIs**: In Google Cloud Console → APIs & Services → Enable:
   - "Google Search Console API"
   - "Google Analytics Data API"
3. **Grant access**:
   - **GSC**: Search Console → Settings → Users → Add service account email as Full user
   - **GA4**: GA4 → Admin → Property Access Management → Add service account email as Viewer
4. **Find your GA4 numeric property ID**: GA4 → Admin → Property Settings → Property ID (a number, NOT the `G-XXXXXXX` measurement ID)

When configured, `brad audit` enriches every page with:
- **GSC**: Impressions, clicks, CTR, avg position, top queries, low-hanging fruit keywords
- **GA4**: Page views, bounce rate, session duration, traffic sources (organic/direct/referral/social)

When not configured, audits still work — suggestions are based on crawl data only.

#### Platform APIs (for future posting)

| Variable | Description |
|----------|-------------|
| `REDDIT_CLIENT_ID` | Reddit OAuth app ID |
| `REDDIT_CLIENT_SECRET` | Reddit OAuth secret |
| `REDDIT_USERNAME` | Reddit account |
| `REDDIT_PASSWORD` | Reddit password |
| `TWITTER_API_KEY` | Twitter/X API key |
| `TWITTER_API_SECRET` | Twitter/X API secret |
| `TWITTER_ACCESS_TOKEN` | Twitter/X OAuth token |
| `TWITTER_ACCESS_SECRET` | Twitter/X OAuth secret |

### LLM Providers

| Provider | Model | Cost | Best For |
|----------|-------|------|----------|
| `openai` | GPT-4o | ~$0.01/audit | Best overall quality |
| `anthropic` | Claude Sonnet | ~$0.01/audit | Strong reasoning |
| `lana` | Local (llama.cpp) | Free | On-premises, private |
| `ollama` | Local (any GGUF) | Free | Development, testing |

### Workspace Structure

```
.brad/
├── config.json          # Full configuration (auto-generated)
├── brand-context.json   # Brand analysis (used in system prompts)
├── findings/            # SEO audits, competitive analyses, reports
├── content/             # Drafted social media posts
│   ├── reddit/
│   ├── twitter/
│   └── blog/
├── campaigns/           # Campaign plans
├── queue/               # Approved items waiting to post
└── history/             # Action log (JSONL)
```

### Config Sections

| Section | What Brad Uses It For |
|---------|----------------------|
| `sites` | URLs to crawl, local dev URL, analytics IDs |
| `focus` | Project paths to scan (templates, routes, docs) |
| `context_files` | Files Brad reads for deep product understanding |
| `brand.voice` | Tone and style for generated content |
| `brand.audience` | Target audience for content strategy |
| `brand.keywords` | Primary, secondary, long-tail SEO targets |
| `brand.competitors` | Companies to track in competitive analysis |
| `brand.differentiators` | Unique selling points woven into content |
| `platforms.reddit` | Subreddits to monitor |
| `platforms.hackernews` | Keywords to watch on HN |
| `platforms.twitter` | Handle and hashtags |
| `lead_data` | Lead source files, target markets, verticals |
| `schedule` | Cron schedules for audit, engage, content |
| `approval` | `require` (review before posting) or `auto` |

---

## How It Works

### `brad init`

```
brad init
  │
  ├── Phase 1: Project Scanner (no LLM, instant)
  │   ├── Scans .env files for analytics IDs
  │   ├── Walks focus paths for templates, docs, data
  │   ├── Identifies context files (knowledge base, SEO strategy)
  │   └── Finds lead data sources (CSVs, JSONs)
  │
  ├── Phase 2: LLM Analyzer
  │   ├── Crawls entire site (follows internal links)
  │   ├── Reads context files from project
  │   ├── Searches web for brand and competitors
  │   └── Outputs structured JSON config
  │
  └── Phase 3: Config Builder
      ├── Merges scanner findings + LLM output
      ├── Saves config.json
      └── Saves brand-context.json
```

### `brad audit`

```
brad audit
  │
  ├── Phase 1: Crawl all pages (parallel fetch + cheerio)
  │
  ├── Phase 1.5: Enrich with analytics (if configured)
  │   ├── Google Search Console → impressions, clicks, CTR, position, top queries
  │   └── Google Analytics 4 → page views, bounce rate, session duration, traffic sources
  │
  ├── Phase 2+3: Sitemap check + competitive search (parallel)
  │
  ├── Phase 4: Analyze each page via LLM (batches of 4, parallel)
  │   └── Each page gets: crawl data + GSC metrics + GA4 metrics
  │
  ├── Phase 5: Generate summary + action plan (LLM)
  │
  └── Phase 6: Assemble report (Node.js)
```

---

## Project Structure

```
brad/
├── bin/brad.js                     # CLI entry point
├── install.sh                      # Install script
├── setup.sh                        # Project setup script
├── skill/SKILL.md                  # Claude Code /brad skill
├── src/
│   ├── cli.js                      # Command router + interactive REPL
│   ├── core/
│   │   ├── agent.js                # LangGraph ReAct agent orchestrator
│   │   ├── llm.js                  # Multi-backend LLM factory
│   │   └── workspace.js            # .brad/ directory management
│   ├── agents/
│   │   ├── competitive-analysis.js # Deep competitor research
│   │   ├── reddit-agent.js         # Reddit monitoring + drafting
│   │   ├── seo-auditor.js          # Page-by-page SEO audit
│   │   └── site-analyzer.js        # Site crawl + config builder
│   ├── tools/
│   │   ├── analytics-enricher.js    # Merges GSC + GA4 data into page results
│   │   ├── file-ops.js             # Read/write findings + project files
│   │   ├── google-analytics.js     # GA4 Data API client
│   │   ├── google-search-console.js# GSC API client
│   │   ├── search.js               # DuckDuckGo web search
│   │   └── web-crawler.js          # Cheerio page + site crawler
│   └── config/
│       ├── defaults.js
│       └── prompts/
│           └── reddit-persona.md
├── .env.example
├── LICENSE
└── README.md
```

---

## License

MIT — see [LICENSE](LICENSE)

Built by [Red Rooster Technologies](https://redroostertec.com)
