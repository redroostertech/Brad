---
name: brad
description: Configure Brad AI CMO — scans the project, detects analytics, files, leads, and builds the complete .brad/config.json. Run this after 'brad init' to populate the config from project context.
argument-hint: [setup|refresh|show]
---

# Brad — AI CMO Configuration Skill

You are configuring **Brad**, the AI CMO agent that runs in this project directory. Brad crawls the live website, audits SEO, scouts Reddit/HN, and drafts social content. But Brad needs a rich config to do its job well.

Your job is to scan THIS project and build/update `.brad/config.json` with everything Brad needs.

## Arguments

- `/brad setup` or `/brad` (no args) — Full scan: build the complete config from scratch
- `/brad refresh` — Re-scan and update existing config (preserves manual edits where possible)
- `/brad show` — Display the current config with a summary

## What to Scan

### 1. Site Configuration
- Read `.brad/config.json` for the existing site URL and name
- Check `.env`, `.env.development`, `.env.production`, `env.example` for:
  - `GOOGLE_ANALYTICS_ID` or `GA4` or `MEASUREMENT_ID` → `sites[0].analytics`
  - Any other analytics service IDs
- Check `app.js` or `index.js` for domain routing, port numbers, or URL rewriting
- Determine the local dev URL (look for PORT in env files)

### 2. Focus Paths
Find all files/directories relevant to the product Brad is marketing. Look for:
- View templates (EJS, HTML, JSX) for the product's pages
- Route files that serve the product's pages and APIs
- Product-specific CSS and JavaScript files
- Sitemap files, robots.txt, ads.txt
- Documentation: SEO strategy, marketing docs, deployment docs
- **Exclude**: node_modules, .git, build artifacts, unrelated products

### 3. Context Files (Brad reads these for deep product understanding)
Identify high-value files Brad should read before making marketing decisions:
- Knowledge base files (training data, product descriptions)
- SEO strategy documents
- Marketing campaign docs, video scripts
- Product manuals or sales docs
- Blog content
- API documentation (for technical content creation)

### 4. Brand Configuration
Analyze the site content (read the view templates and docs) to determine:
- `voice` — How does the site communicate? (formal/casual, technical/accessible, etc.)
- `audience` — Who is this product for? Be specific: role, company size, industry
- `differentiators` — What makes this product unique? List 3-5 concrete things
- `competitors` — Check docs and site content for mentioned competitors. If none found, leave empty (Brad will search the web for these)
- `keywords.primary` — 5 high-volume keywords from page titles, H1s, meta descriptions
- `keywords.secondary` — 5 more specific keywords from page content
- `keywords.long_tail` — 5 phrases a real user would type into Google

### 5. Platform Configuration
Based on the product's industry and audience:
- `reddit.subreddits` — 5-10 relevant subreddits where the target audience hangs out
- `hackernews.keywords` — 5-7 technical keywords HN readers would discuss
- `twitter.hashtags` — 5-8 relevant hashtags

### 6. Lead Data
Scan the `data/` directory and any CSV/JSON files for:
- Lead lists (lawyers, companies, contacts)
- Geographic markets (cities, states)
- Industry verticals or practice areas
- Record the file paths in `lead_data.sources`

## Output Format

Write the complete config to `.brad/config.json`. The structure MUST be:

```json
{
  "version": "0.1.0",
  "sites": [{
    "name": "Product Name",
    "url": "https://live-url.com",
    "local": "http://localhost:PORT/path",
    "production": "https://production-url.com/path",
    "analytics": {
      "ga4_dev": "G-XXXXXX",
      "ga4_prod": "G-YYYYYY"
    }
  }],
  "focus": ["path/to/relevant/dir", "path/to/file.js"],
  "context_files": ["docs/seo/strategy.md", "data/knowledge-base.txt"],
  "provider": "openai",
  "platforms": {
    "reddit": { "subreddits": [], "enabled": true },
    "hackernews": { "keywords": [], "enabled": true },
    "twitter": { "handle": "", "hashtags": [], "enabled": false }
  },
  "brand": {
    "voice": "",
    "audience": "",
    "differentiators": [],
    "competitors": [],
    "keywords": {
      "primary": [],
      "secondary": [],
      "long_tail": []
    }
  },
  "lead_data": {
    "sources": [],
    "markets": [],
    "practice_areas": []
  },
  "schedule": {
    "audit": "0 6 * * *",
    "engage": "0 8,14 * * *",
    "content": "0 7 * * 1,3,5"
  },
  "approval": "require"
}
```

## Rules

- **Be thorough.** Read actual file contents, don't guess from filenames alone.
- **Be specific.** "Managing partners at mid-size law firms" is better than "legal professionals".
- **Don't invent competitors.** Only list competitors explicitly mentioned in project docs. Brad will discover more via web search.
- **Preserve existing values.** On `/brad refresh`, keep manually-set values (like twitter handle) and only update what the scan finds.
- **Show your work.** After writing the config, print a summary of what you found and configured.
