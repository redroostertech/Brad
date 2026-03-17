/**
 * Site Analyzer Agent — the full init pipeline
 *
 * Phase 1: Project Scanner (no LLM) — auto-detects files, analytics IDs, structure
 * Phase 2: LLM Analyzer — crawls site, reads docs, outputs structured config JSON
 */

import { createBradAgent, runAgent } from '../core/agent.js';
import { crawlPage, crawlSitemap, crawlSite } from '../tools/web-crawler.js';
import { webSearch } from '../tools/search.js';
import { createFileTools } from '../tools/file-ops.js';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';

// ── Phase 1: Project Scanner (deterministic, no LLM) ──────────────

/**
 * Scan the project for config-worthy files.
 * @param {string} projectDir - absolute path to project root
 * @param {string[]} userFocusPaths - if provided, ONLY scan these paths (+ env files for analytics)
 */
async function scanProjectForConfig(projectDir, userFocusPaths = []) {
  const detected = {
    analytics: {},
    contextFiles: [],
    focusPaths: [],
  };

  // Always scan env files for analytics IDs regardless of focus
  for (const envFile of ['.env', '.env.development', '.env.production', 'env.example']) {
    try {
      const content = await readFile(join(projectDir, envFile), 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const eqIdx = trimmed.indexOf('=');
        const key = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim();

        if (key.includes('GOOGLE_ANALYTICS') || key.includes('GA4') || key.includes('MEASUREMENT_ID')) {
          if (envFile.includes('prod')) {
            detected.analytics.ga4_prod = value;
          } else if (envFile.includes('dev')) {
            detected.analytics.ga4_dev = value;
          } else {
            detected.analytics.ga4 = value;
          }
        }
      }
    } catch { /* skip */ }
  }

  // ── Focused scan: user gave specific paths ──
  if (userFocusPaths.length > 0) {
    for (const fp of userFocusPaths) {
      const fullPath = join(projectDir, fp);
      try {
        const s = await stat(fullPath);
        if (s.isDirectory()) {
          detected.focusPaths.push(fp);
          await scanDir(projectDir, fp, fp, detected, 0);
        } else {
          detected.focusPaths.push(fp);
          classifyFile(fp, detected);
        }
      } catch { /* path doesn't exist, skip */ }
    }
    return detected;
  }

  // ── Full scan: no focus paths, scan everything ──

  // Top-level files
  for (const f of ['README.md', 'CLAUDE.md', 'package.json', 'app.js', 'index.js']) {
    try {
      await stat(join(projectDir, f));
      detected.focusPaths.push(f);
    } catch { /* skip */ }
  }

  // Key directories
  for (const dir of ['docs', 'data', 'content', 'views', 'routes', 'public']) {
    try {
      await stat(join(projectDir, dir));
      await scanDir(projectDir, dir, dir, detected, 0);
    } catch { /* skip */ }
  }

  // Root-level context files (knowledge bases, manuals, etc.)
  try {
    const rootEntries = await readdir(projectDir, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isFile() && !entry.name.startsWith('.')) {
        const ext = entry.name.split('.').pop().toLowerCase();
        if (['txt', 'md', 'pdf'].includes(ext)) {
          classifyFile(entry.name, detected);
          detected.focusPaths.push(entry.name);
        }
      }
    }
  } catch { /* skip */ }

  return detected;
}

async function scanDir(projectDir, dir, prefix, detected, depth) {
  if (depth > 3) return;
  try {
    const entries = await readdir(join(projectDir, dir), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relativePath = `${prefix}/${entry.name}`;

      if (entry.isDirectory()) {
        detected.focusPaths.push(relativePath);
        await scanDir(projectDir, join(dir, entry.name), relativePath, detected, depth + 1);
      } else {
        const ext = entry.name.split('.').pop().toLowerCase();
        if (['md', 'txt', 'json', 'csv', 'ejs', 'html', 'js', 'css'].includes(ext)) {
          detected.focusPaths.push(relativePath);
          classifyFile(relativePath, detected);
        }
      }
    }
  } catch { /* dir doesn't exist */ }
}

function classifyFile(relativePath, detected) {
  const name = relativePath.toLowerCase();
  if (name.includes('knowledge') || name.includes('seo') || name.includes('marketing')
      || name.includes('strategy') || name.includes('manual') || name.includes('text')
      || name.includes('video-script') || name.includes('video_script')) {
    detected.contextFiles.push(relativePath);
  }
  // Data directory txt files are often lead lists or knowledge bases
  if (name.startsWith('data/') && name.endsWith('.txt')) {
    detected.contextFiles.push(relativePath);
  }
}

// ── Phase 2: LLM Site Analysis + Config Generation ─────────────────

const ANALYZE_PROMPT = (siteUrl, siteName, projectScan) => `
You are initializing Brad (AI CMO) for the product "${siteName}" at ${siteUrl}.

Your job is to:
1. Crawl the website thoroughly
2. Read key project files to understand the product deeply
3. Search the web for the brand and competitors
4. Output a COMPLETE, structured configuration

## Step 1: Crawl the Site
Use crawl_site with URL ${siteUrl} and maxPages 15.

## Step 2: Read Project Context Files
Use read_project_file to read these files that were detected in the project:
${projectScan.contextFiles.map(f => `- ${f}`).join('\n')}

Read as many as you can — they contain product details, SEO strategy, and marketing context.

## Step 3: Search the Web
- Search for "${siteName}" to see what appears
- Search for 2-3 relevant keywords to identify competitors
- Only report competitors you actually find in search results

## Step 4: Output
After gathering all data, you MUST save a finding with filename "brad-config-output.json" containing ONLY valid JSON (no markdown fencing, no explanation — just the JSON object).

The JSON must follow this exact structure:

{
  "brand": {
    "voice": "Describe the brand's communication tone based on what you read on the site and in project files",
    "audience": "Specific target audience based on site content (be detailed — role, company size, industry)",
    "differentiators": ["Unique selling point 1", "USP 2", "USP 3", "USP 4", "USP 5"],
    "competitors": ["Only competitors found in actual search results"],
    "keywords": {
      "primary": ["5 high-volume keywords based on site content and industry"],
      "secondary": ["5 medium-volume, more specific keywords"],
      "long_tail": ["5 long-tail phrases real users would search for"]
    }
  },
  "platforms": {
    "reddit": {
      "subreddits": ["relevant subreddits based on the product's industry and audience — 5 to 10"],
      "enabled": true
    },
    "hackernews": {
      "keywords": ["keywords to watch for on HN — based on the product's technical angle"],
      "enabled": true
    },
    "twitter": {
      "handle": "",
      "hashtags": ["relevant hashtags — 5 to 8"],
      "enabled": false
    }
  },
  "lead_data": {
    "markets": ["geographic markets if detectable from project files, otherwise empty"],
    "practice_areas": ["industry verticals or specialties if detectable, otherwise empty"]
  },
  "brand_context": {
    "name": "${siteName}",
    "url": "${siteUrl}",
    "valueProposition": "The core promise in 1-2 sentences",
    "audience": "Same as brand.audience above",
    "voice": "Same as brand.voice above",
    "differentiators": ["Same as brand.differentiators above"],
    "keywords": ["Top 10 combined keywords"],
    "competitors": ["Same as brand.competitors above"]
  }
}

CRITICAL:
- The file "brad-config-output.json" must contain ONLY the raw JSON. No markdown, no \`\`\` fences, no explanation text.
- Every field must be populated based on what you actually observed from crawling and reading files.
- Competitors must come from actual search results, not your training data.
- Keywords must be grounded in what the site actually talks about.
- If you can't determine something, use an empty array or empty string — don't guess.

Also save a human-readable finding with filename "brand-analysis.md" with your full analysis narrative.
`;

/**
 * @param {BaseChatModel} llm
 * @param {Workspace} workspace
 * @param {object} options
 * @param {function} options.log - callback(message) for activity logging
 */
export async function analyzeSite(llm, workspace, options = {}) {
  const log = options.log || (() => {});
  const config = await workspace.loadConfig();
  const site = config.sites[0];

  if (!site) {
    throw new Error('No site configured. Run: brad init --site <url>');
  }

  // Phase 1: Deterministic project scan (respects --focus if provided)
  const userFocusPaths = config.focus || [];
  log(`Scanning project${userFocusPaths.length > 0 ? ` (${userFocusPaths.length} focus paths)` : ' (full scan)'}...`);
  const projectScan = await scanProjectForConfig(workspace.projectDir, userFocusPaths);
  log(`  Found ${projectScan.focusPaths.length} files/dirs, ${projectScan.contextFiles.length} context files`);
  if (projectScan.analytics.ga4_dev || projectScan.analytics.ga4_prod) {
    log(`  Analytics: ${projectScan.analytics.ga4_dev ? 'GA4 dev ' + projectScan.analytics.ga4_dev : ''} ${projectScan.analytics.ga4_prod ? 'GA4 prod ' + projectScan.analytics.ga4_prod : ''}`.trim());
  }
  if (projectScan.contextFiles.length > 0) {
    for (const cf of projectScan.contextFiles) {
      log(`  Context file: ${cf}`);
    }
  }

  const fileTools = createFileTools(workspace);
  const tools = [crawlPage, crawlSitemap, crawlSite, webSearch, ...fileTools];

  log('Starting LLM analysis...');
  const agent = createBradAgent(llm, tools, { config });

  // Phase 2: LLM analysis with tool call logging
  const toolDescriptions = {
    crawl_site: (args) => `Crawling site: ${args.url} (max ${args.maxPages || 10} pages)`,
    crawl_page: (args) => `Crawling page: ${args.url}`,
    crawl_sitemap: (args) => `Checking sitemap: ${args.url}`,
    web_search: (args) => `Searching: "${args.query}"`,
    read_project_file: (args) => `Reading: ${args.path}`,
    list_directory: (args) => `Listing: ${args.path || '/'}`,
    save_finding: (args) => `Saving finding: ${args.filename}`,
    save_content: (args) => `Saving content: ${args.platform}/${args.filename}`,
  };

  const result = await runAgent(agent, ANALYZE_PROMPT(site.url, site.name, projectScan), {
    onToolCall: (name, args) => {
      const desc = toolDescriptions[name];
      log(desc ? desc(args) : `Calling: ${name}`);
    },
    onToolResult: (name) => {
      log(`  Done: ${name}`);
    },
  });

  // Phase 3: Parse the LLM's structured output and merge into config
  log('Building config from analysis...');
  try {
    const configOutput = await workspace.readFinding('brad-config-output.json');
    // Strip any markdown fencing the LLM might have added despite instructions
    const cleaned = configOutput.replace(/^```[\s\S]*?\n/, '').replace(/\n```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    log('  Parsed LLM config output');

    // Merge LLM output into existing config
    const updatedConfig = { ...config };

    // Brand
    if (parsed.brand) {
      updatedConfig.brand = { ...updatedConfig.brand, ...parsed.brand };
      const kw = parsed.brand.keywords;
      const kwCount = (kw?.primary?.length || 0) + (kw?.secondary?.length || 0) + (kw?.long_tail?.length || 0);
      log(`  Brand: ${parsed.brand.differentiators?.length || 0} differentiators, ${kwCount} keywords`);
    }

    // Platforms
    if (parsed.platforms) {
      updatedConfig.platforms = { ...updatedConfig.platforms, ...parsed.platforms };
      const subs = parsed.platforms.reddit?.subreddits?.length || 0;
      const hnKw = parsed.platforms.hackernews?.keywords?.length || 0;
      log(`  Platforms: ${subs} subreddits, ${hnKw} HN keywords`);
    }

    // Lead data
    if (parsed.lead_data) {
      const dataSources = projectScan.focusPaths.filter(p => p.startsWith('data/'));
      updatedConfig.lead_data = {
        sources: dataSources,
        ...parsed.lead_data,
      };
      log(`  Leads: ${dataSources.length} source files, ${parsed.lead_data.markets?.length || 0} markets`);
    }

    // Focus paths and context files from the project scan
    updatedConfig.focus = projectScan.focusPaths.length > 0
      ? projectScan.focusPaths
      : config.focus;

    updatedConfig.context_files = projectScan.contextFiles.length > 0
      ? projectScan.contextFiles
      : config.context_files;

    log(`  Focus: ${updatedConfig.focus.length} paths, ${updatedConfig.context_files?.length || 0} context files`);

    // Analytics from env scan
    if (projectScan.analytics.ga4_dev || projectScan.analytics.ga4_prod || projectScan.analytics.ga4) {
      updatedConfig.sites[0].analytics = {
        ...updatedConfig.sites[0].analytics,
        ...projectScan.analytics,
      };
      log(`  Analytics: configured`);
    }

    await workspace.saveConfig(updatedConfig);
    log('Config saved to .brad/config.json');

    // Save brand context
    if (parsed.brand_context) {
      await workspace.saveBrandContext({
        ...parsed.brand_context,
        analyzedAt: new Date().toISOString(),
      });
      log('Brand context saved to .brad/brand-context.json');
    }
  } catch (err) {
    log(`Config merge failed: ${err.message} — saving minimal brand context`);
    // Fallback: save minimal brand context from the narrative
    await workspace.saveBrandContext({
      name: site.name,
      url: site.url,
      analyzedAt: new Date().toISOString(),
    });
  }

  await workspace.appendHistory({
    action: 'site_analysis',
    site: site.url,
    toolCalls: result.toolCalls,
  });

  return result;
}
