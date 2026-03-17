# B.R.A.D.

**Brand Reach Automation & Distribution**

Your autonomous AI Chief Marketing Officer. Brad lives in your project directory, crawls your website, audits your SEO, scouts Reddit and Hacker News for engagement opportunities, researches competitors, and drafts content — all from the terminal.

---

## Install

### Prerequisites

- **Node.js** 20+
- **An LLM API key** — OpenAI, Anthropic, or a local LANA/Ollama instance

### From Source

```bash
git clone https://github.com/redroostertechnologies/brad.git
cd brad
npm install
npm link
```

This installs `brad` as a global command. Verify:

```bash
brad --version
```

### From npm (coming soon)

```bash
npm install -g @redrooster/brad
```

---

## Quick Start

### 1. Initialize in your project

```bash
cd ~/your-project
brad init --site https://yoursite.com --name "Your Product"
```

Brad will:
- Create a `.brad/` workspace in your project
- Scan your project for relevant files, analytics IDs, docs, and lead data
- Crawl your live website (follows all internal links)
- Search the web for your brand and competitors
- Build the complete config — brand voice, keywords, platforms, everything

#### Focus on specific directories

If your project is large or multi-product, tell Brad where to look:

```bash
brad init --site https://yoursite.com --name "Your Product" \
  --focus "views/your-product,routes/your-product.js,docs/seo,data"
```

#### Choose your LLM provider

```bash
# OpenAI (default)
export OPENAI_API_KEY=sk-your-key
brad init --site https://yoursite.com --name "Your Product"

# Anthropic
export ANTHROPIC_API_KEY=sk-ant-your-key
brad init --site https://yoursite.com --name "Your Product" --provider anthropic

# Local LANA-AI server
brad init --site https://yoursite.com --name "Your Product" --provider lana

# Local Ollama
brad init --site https://yoursite.com --name "Your Product" --provider ollama
```

### 2. Run an SEO audit

```bash
brad audit
```

Crawls every page on your site, checks meta tags, headings, content depth, keyword presence, and competitor rankings. Saves a detailed report to `.brad/findings/`.

### 3. Scout social platforms

```bash
brad scout
```

Searches Reddit for relevant discussions, drafts authentic replies that drive traffic without being promotional.

### 4. Run competitive analysis

```bash
brad compete         # Foreground with live activity log
brad compete --bg    # Background — check findings later
```

Searches for your keywords, discovers competitors, crawls their sites, compares positioning, and produces a strategic report.

### 5. Interactive mode

```bash
brad
```

Ask Brad anything — he has access to your site crawler, web search, and project files.

---

## Commands

### Setup
| Command | Description |
|---------|-------------|
| `brad init --site <url> --name <name>` | Initialize workspace and build config |

Options: `--provider`, `--local`, `--focus`, `--skip-analysis`

### Analysis
| Command | Description |
|---------|-------------|
| `brad analyze` | Re-crawl site and refresh brand context |
| `brad audit` | Full SEO audit with page-by-page breakdown |
| `brad compete` | Deep competitive analysis (`--bg` for background) |
| `brad scout` | Scout Reddit for engagement opportunities |

### View Results
| Command | Description |
|---------|-------------|
| `brad config` | Show current configuration |
| `brad findings` | List all saved findings |
| `brad read <file>` | Read a specific finding |
| `brad status` | Show workspace overview |

### Maintenance
| Command | Description |
|---------|-------------|
| `brad cleanse` | Remove all Brad data from project (requires confirmation) |
| `brad help` | Show all commands |

---

## Claude Code Skill (`/brad`)

Brad includes an optional Claude Code skill that scans your repo for deeper config enrichment. Claude Code is better at reading project files (templates, routes, docs) while Brad is better at crawling live sites and searching the web.

### Install the skill

Copy the skill directory into your project:

```bash
mkdir -p .claude/skills/brad
cp /path/to/brad/skill/SKILL.md .claude/skills/brad/SKILL.md
```

Or create `.claude/skills/brad/SKILL.md` in your project with the contents from [skill/SKILL.md](skill/SKILL.md).

### Use the skill

In Claude Code, inside your project:

```
/brad setup     # Full scan — builds complete .brad/config.json
/brad refresh   # Re-scan and update existing config
/brad show      # Display current config summary
```

The skill reads your env files, view templates, routes, docs, and data files to build a richer config than Brad's CLI can produce on its own.

---

## Configuration

Brad stores its workspace in `.brad/` inside your project:

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

### Key config sections

| Section | What Brad uses it for |
|---------|----------------------|
| `sites` | URLs to crawl, analytics IDs |
| `focus` | Project paths to scan (templates, routes, docs) |
| `context_files` | Files Brad reads for deep product understanding |
| `brand.keywords` | Primary, secondary, and long-tail SEO targets |
| `brand.competitors` | Companies to track in competitive analysis |
| `brand.differentiators` | Unique selling points woven into content |
| `platforms.reddit` | Subreddits to monitor |
| `platforms.hackernews` | Keywords to watch on HN |
| `lead_data` | Lead source files, target markets, verticals |

### Environment variables

| Variable | Required for |
|----------|-------------|
| `ANTHROPIC_API_KEY` | `--provider anthropic` |
| `BRAD_LLM_PROVIDER` | Default provider override |
| `OPENAI_API_KEY` | `--provider openai` (default) |

---

## LLM Providers

Brad supports four LLM backends. Switch with `--provider` on init or set `BRAD_LLM_PROVIDER`:

| Provider | Model | Cost | Best for |
|----------|-------|------|----------|
| `openai` | GPT-4o | ~$0.01/audit | Best overall quality |
| `anthropic` | Claude Sonnet | ~$0.01/audit | Strong reasoning |
| `lana` | Local (llama.cpp) | Free | On-premises, private |
| `ollama` | Local (any GGUF) | Free | Development, testing |

---

## How It Works

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
      ├── Saves config.json (brand, keywords, platforms, leads)
      └── Saves brand-context.json (for system prompts)
```

---

## Project Structure

```
brad/
├── bin/brad.js                     # CLI entry point
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
│   │   ├── file-ops.js             # Read/write findings + project files
│   │   ├── search.js               # DuckDuckGo web search
│   │   └── web-crawler.js          # Cheerio page + site crawler
│   └── config/
│       ├── defaults.js
│       └── prompts/
│           └── reddit-persona.md   # Reddit engagement guidelines
├── skill/
│   └── SKILL.md                    # Claude Code /brad skill
├── .env.example
└── README.md
```

---

## License

MIT

---

Built by [Red Rooster Technologies](https://redroostertec.com)
