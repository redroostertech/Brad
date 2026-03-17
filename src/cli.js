/**
 * Brad CLI — the Claude Code-like interface for your AI CMO
 *
 * Commands:
 *   brad init --site <url> --name <name>    Initialize workspace
 *   brad analyze                             Run site analysis
 *   brad audit                               Run SEO audit
 *   brad scout                               Scout Reddit for opportunities
 *   brad status                              Show workspace status
 *   brad findings                            List recent findings
 *   brad read <finding>                      Read a specific finding
 *   brad config                              Show/edit configuration
 *   brad                                     Interactive mode
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface } from 'readline';
import { Workspace } from './core/workspace.js';
import { createLLM, listProviders } from './core/llm.js';
import { analyzeSite } from './agents/site-analyzer.js';
import { runSEOAudit } from './agents/seo-auditor.js';
import { scoutReddit } from './agents/reddit-agent.js';
import { runCompetitiveAnalysis } from './agents/competitive-analysis.js';
import { fork } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { config as loadEnv } from 'dotenv';

// Load .env from brad project root AND current directory
loadEnv({ path: join(import.meta.dirname, '..', '.env') });
loadEnv();

const VERSION = '0.1.0';

function banner(workspace) {
  const lines = [
    '',
    chalk.bold.cyan('  ╔═══════════════════════════════════════════════════╗'),
    chalk.bold.cyan('  ║') + chalk.bold.white('  B.R.A.D. — Brand Reach Automation & Distribution  ') + chalk.bold.cyan('║'),
    chalk.bold.cyan('  ╚═══════════════════════════════════════════════════╝'),
  ];

  if (workspace) {
    lines.push(chalk.gray(`  Workspace: ${workspace.projectDir}`));
  }

  lines.push('');
  return lines.join('\n');
}

function printHelp() {
  console.log(chalk.gray(`
  Commands:
    ${chalk.white('analyze')}     Re-analyze your website and refresh brand context
    ${chalk.white('audit')}       Run an SEO audit
    ${chalk.white('compete')}     Deep competitive analysis
    ${chalk.white('config')}      Show current configuration
    ${chalk.white('findings')}    List all findings
    ${chalk.white('help')}        Show this help
    ${chalk.white('read')} <file>  Read a specific finding
    ${chalk.white('scout')}       Scout Reddit for engagement opportunities
    ${chalk.white('status')}      Show workspace status and recent activity
    ${chalk.white('exit')}        Exit Brad
    ${chalk.white('exit')}        Exit Brad

  Or just type a question / instruction and Brad will figure it out.
  `));
}

async function showStatus(workspace) {
  const config = await workspace.loadConfig();
  const findings = await workspace.listFindings();
  const brandContext = await workspace.loadBrandContext();

  console.log('');
  console.log(chalk.bold('  Site:'), config.sites[0]?.url || chalk.red('Not configured'));
  console.log(chalk.bold('  Provider:'), config.provider);
  console.log(chalk.bold('  Brand Context:'), brandContext ? chalk.green('Loaded') : chalk.yellow('Not analyzed yet — run "analyze"'));
  console.log(chalk.bold('  Findings:'), findings.length > 0 ? `${findings.length} reports` : chalk.gray('None yet'));
  console.log(chalk.bold('  Approval Mode:'), config.approval);

  if (findings.length > 0) {
    console.log('');
    console.log(chalk.bold('  Recent Findings:'));
    for (const f of findings.slice(0, 5)) {
      console.log(chalk.gray(`    - ${f}`));
    }
  }

  console.log('');
}

async function interactiveMode(workspace) {
  const config = await workspace.loadConfig();
  let llm = null;
  const brandContext = await workspace.loadBrandContext();

  function getLLM() {
    if (!llm) {
      llm = createLLM({ provider: config.provider });
    }
    return llm;
  }

  console.log(banner(workspace));
  console.log(chalk.gray(`  Provider: ${config.provider} | Site: ${config.sites[0]?.url || 'none'}`));
  console.log(chalk.gray(`  Type "help" for commands or ask Brad anything.\n`));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('  brad> '),
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    try {
      switch (input.toLowerCase()) {
        case 'help':
          printHelp();
          break;

        case 'exit':
        case 'quit':
          console.log(chalk.gray('\n  See you tomorrow. Brad never sleeps.\n'));
          process.exit(0);

        case 'status':
          await showStatus(workspace);
          break;

        case 'analyze': {
          const spinner = ora({ text: 'Analyzing site...', indent: 2 }).start();
          try {
            const result = await analyzeSite(getLLM(), workspace);
            spinner.succeed('Site analysis complete');
            console.log('\n' + result.content + '\n');
          } catch (err) {
            spinner.fail(`Analysis failed: ${err.message}`);
          }
          break;
        }

        case 'audit': {
          const spinner = ora({ text: 'Running SEO audit...', indent: 2 }).start();
          try {
            const result = await runSEOAudit(getLLM(), workspace);
            spinner.succeed('SEO audit complete');
            console.log('\n' + result.content + '\n');
          } catch (err) {
            spinner.fail(`Audit failed: ${err.message}`);
          }
          break;
        }

        case 'scout': {
          const spinner = ora({ text: 'Scouting Reddit...', indent: 2 }).start();
          try {
            const result = await scoutReddit(getLLM(), workspace);
            spinner.succeed('Reddit scout complete');
            console.log('\n' + result.content + '\n');
          } catch (err) {
            spinner.fail(`Scout failed: ${err.message}`);
          }
          break;
        }

        case 'compete':
        case 'competitive-analysis': {
          console.log(chalk.cyan('\n  Running competitive analysis (3-5 min)...\n'));
          const compLog = (msg) => {
            const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
            console.log(chalk.gray(`  ${ts}`) + `  ${msg}`);
          };
          try {
            const result = await runCompetitiveAnalysis(getLLM(), workspace, { log: compLog });
            console.log(chalk.green('\n  Competitive analysis complete.\n'));
            console.log(result.content + '\n');
          } catch (err) {
            console.log(chalk.red(`\n  Failed: ${err.message}\n`));
          }
          break;
        }

        case 'findings': {
          const findings = await workspace.listFindings();
          if (findings.length === 0) {
            console.log(chalk.gray('\n  No findings yet. Run "audit" or "scout" first.\n'));
          } else {
            console.log('');
            for (const f of findings) {
              console.log(chalk.white(`  - ${f}`));
            }
            console.log(chalk.gray(`\n  Use "read <filename>" to view a finding.\n`));
          }
          break;
        }

        case 'config': {
          const cfg = await workspace.loadConfig();
          console.log('\n' + JSON.stringify(cfg, null, 2) + '\n');
          break;
        }

        default: {
          if (input.startsWith('read ')) {
            const filename = input.substring(5).trim();
            try {
              const content = await workspace.readFinding(filename);
              console.log('\n' + content + '\n');
            } catch {
              console.log(chalk.red(`\n  Finding not found: ${filename}\n`));
            }
            break;
          }

          // Free-form message — send to the agent
          const spinner = ora({ text: 'Thinking...', indent: 2 }).start();
          try {
            const { createBradAgent, runAgent } = await import('./core/agent.js');
            const { crawlPage, crawlSitemap, crawlSite } = await import('./tools/web-crawler.js');
            const { webSearch } = await import('./tools/search.js');
            const { createFileTools } = await import('./tools/file-ops.js');

            const fileTools = createFileTools(workspace);
            const tools = [crawlPage, crawlSitemap, crawlSite, webSearch, ...fileTools];
            const agent = createBradAgent(getLLM(), tools, { brandContext, config });

            const result = await runAgent(agent, input);
            spinner.stop();
            console.log('\n' + result.content + '\n');
          } catch (err) {
            spinner.fail(`Error: ${err.message}`);
          }
        }
      }
    } catch (err) {
      console.log(chalk.red(`\n  Error: ${err.message}\n`));
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.gray('\n  See you tomorrow. Brad never sleeps.\n'));
    process.exit(0);
  });
}

export function cli(argv) {
  const program = new Command();

  program
    .name('brad')
    .description('B.R.A.D. — Brand Reach Automation & Distribution')
    .version(VERSION);

  // ── init ───────────────────────────────────────────────────
  program
    .command('init')
    .description('Initialize Brad workspace: create config, crawl site, build brand context')
    .requiredOption('-s, --site <url>', 'Your website URL (e.g., https://lanaai.io)')
    .option('-n, --name <name>', 'Your product/company name', 'My Product')
    .option('-p, --provider <provider>', 'LLM provider: openai, anthropic, lana, ollama', 'openai')
    .option('-l, --local <url>', 'Local dev URL (e.g., http://localhost:1234/lana-ai)')
    .option('--ga4 <id>', 'Google Analytics 4 property ID')
    .option('-f, --focus <paths>', 'Focus on specific directories (comma-separated, e.g., views/lana-ai,routes/lana-ai.js)')
    .option('--skip-analysis', 'Only create workspace, skip site analysis')
    .action(async (opts) => {
      const workspace = new Workspace(process.cwd());
      const alreadyExists = await workspace.exists();
      const brandContext = alreadyExists ? await workspace.loadBrandContext() : null;

      // Fully initialized — point to refresh options
      if (alreadyExists && brandContext) {
        console.log(chalk.yellow('\n  Brad is already initialized here with brand context.'));
        console.log(chalk.gray('  Run "brad analyze" to refresh, or "brad cleanse" to start over.'));
        console.log(chalk.gray('  Run /brad in Claude Code to reconfigure from project files.\n'));
        return;
      }

      // Workspace exists but no brand context — resume from analysis
      const resuming = alreadyExists && !brandContext;

      console.log(banner(null));

      if (!alreadyExists) {
        const initSpinner = ora({ text: 'Creating workspace...', indent: 2 }).start();
        await workspace.init({
          site: opts.site,
          name: opts.name,
          provider: opts.provider,
          local: opts.local,
          ga4: opts.ga4,
          focus: opts.focus ? opts.focus.split(',').map(p => p.trim()) : [],
        });
        initSpinner.succeed('Workspace created');
        console.log(chalk.gray(`  Site: ${opts.site}`));
        console.log(chalk.gray(`  Provider: ${opts.provider}`));
      } else {
        console.log(chalk.cyan('  Resuming setup (workspace exists, brand context missing)...'));
      }

      const config = await workspace.loadConfig();
      const provider = opts.provider || config.provider;
      const siteUrl = config.sites[0]?.url || opts.site;

      if (opts.skipAnalysis) {
        console.log('');
        console.log(chalk.white('  Workspace ready. Run /brad in Claude Code to build the full config,'));
        console.log(chalk.white('  or run "brad" for interactive mode.\n'));
        return;
      }

      // Validate API key before starting
      let llm;
      try {
        llm = createLLM({ provider });
      } catch (err) {
        console.log(chalk.red(`\n  LLM setup failed: ${err.message}`));
        console.log(chalk.yellow('  Option 1: Set your API key and re-run:\n'));
        console.log(chalk.white(`    export OPENAI_API_KEY=sk-your-key`));
        console.log(chalk.white(`    brad init --site ${siteUrl} --name "${config.sites[0]?.name || opts.name}"`));
        console.log(chalk.yellow('\n  Option 2: Run /brad in Claude Code to build config from project files.\n'));
        return;
      }

      // Full analysis: scan project + crawl site + build config
      console.log('');
      console.log(chalk.bold.cyan('  Starting full initialization...'));
      console.log(chalk.gray('  Press ESC twice to abort.\n'));

      // Double-ESC abort handler
      let abortController = new AbortController();
      let lastEsc = 0;
      const originalRawMode = process.stdin.isRaw;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', (key) => {
          if (key[0] === 27) { // ESC
            const now = Date.now();
            if (now - lastEsc < 500) {
              console.log(chalk.yellow('\n\n  Aborted by user.'));
              console.log(chalk.gray('  Workspace exists — re-run "brad init" to resume.\n'));
              process.stdin.setRawMode(false);
              process.exit(0);
            }
            lastEsc = now;
          }
        });
      }

      // Activity log renderer
      const logLine = (msg) => {
        const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
        console.log(chalk.gray(`  ${timestamp}`) + `  ${msg}`);
      };

      try {
        const result = await analyzeSite(llm, workspace, { log: logLine });

        // Clean up stdin
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
        }

        console.log('');
        console.log(chalk.bold.green('  Initialization complete.'));

        // Show what got configured
        const updatedConfig = await workspace.loadConfig();
        const brandCount = updatedConfig.brand?.differentiators?.length || 0;
        const keywordCount = (updatedConfig.brand?.keywords?.primary?.length || 0)
          + (updatedConfig.brand?.keywords?.secondary?.length || 0)
          + (updatedConfig.brand?.keywords?.long_tail?.length || 0);
        const focusCount = updatedConfig.focus?.length || 0;
        const contextCount = updatedConfig.context_files?.length || 0;
        const subredditCount = updatedConfig.platforms?.reddit?.subreddits?.length || 0;

        console.log(chalk.gray(`  Config: ${focusCount} focus paths, ${contextCount} context files, ${brandCount} differentiators, ${keywordCount} keywords, ${subredditCount} subreddits`));
        console.log('');
        console.log(chalk.white('  Next steps:'));
        console.log(chalk.gray('    brad audit    — Run an SEO audit'));
        console.log(chalk.gray('    brad scout    — Find Reddit engagement opportunities'));
        console.log(chalk.gray('    brad          — Interactive mode'));
        console.log('');
      } catch (err) {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
        }
        console.log(chalk.red(`\n  Initialization failed: ${err.message}`));
        console.log(chalk.yellow('  Workspace exists — re-run "brad init" to resume.\n'));
      }
    });

  // ── analyze ────────────────────────────────────────────────
  program
    .command('analyze')
    .description('Re-analyze your website and refresh brand context')
    .action(async () => {
      const workspace = new Workspace(process.cwd());
      if (!await workspace.exists()) {
        console.log(chalk.red('\n  No Brad workspace found. Run "brad init --site <url>" first.\n'));
        return;
      }

      const config = await workspace.loadConfig();
      const llm = createLLM({ provider: config.provider });

      const spinner = ora({ text: 'Re-analyzing site...', indent: 2 }).start();
      try {
        const result = await analyzeSite(llm, workspace);
        spinner.succeed('Site analysis refreshed — brand context updated');
        console.log('\n' + result.content + '\n');
      } catch (err) {
        spinner.fail(`Analysis failed: ${err.message}`);
      }
    });

  // ── audit ──────────────────────────────────────────────────
  program
    .command('audit')
    .description('Run an SEO audit on your website')
    .action(async () => {
      const workspace = new Workspace(process.cwd());
      if (!await workspace.exists()) {
        console.log(chalk.red('\n  No Brad workspace found. Run "brad init --site <url>" first.\n'));
        return;
      }

      const config = await workspace.loadConfig();
      const llm = createLLM({ provider: config.provider });

      console.log(chalk.bold.cyan('\n  Running SEO audit...\n'));
      const logLine = (msg) => {
        const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
        console.log(chalk.gray(`  ${ts}`) + `  ${msg}`);
      };
      try {
        const result = await runSEOAudit(llm, workspace, { log: logLine });
        console.log(chalk.bold.green('\n  SEO audit complete.\n'));
        console.log(result.content + '\n');
      } catch (err) {
        console.log(chalk.red(`\n  Audit failed: ${err.message}\n`));
      }
    });

  // ── scout ──────────────────────────────────────────────────
  program
    .command('scout')
    .description('Scout Reddit for engagement opportunities')
    .action(async () => {
      const workspace = new Workspace(process.cwd());
      if (!await workspace.exists()) {
        console.log(chalk.red('\n  No Brad workspace found. Run "brad init --site <url>" first.\n'));
        return;
      }

      const config = await workspace.loadConfig();
      const llm = createLLM({ provider: config.provider });

      const spinner = ora({ text: 'Scouting Reddit...', indent: 2 }).start();
      try {
        const result = await scoutReddit(llm, workspace);
        spinner.succeed('Reddit scout complete');
        console.log('\n' + result.content + '\n');
      } catch (err) {
        spinner.fail(`Scout failed: ${err.message}`);
      }
    });

  // ── competitive-analysis ────────────────────────────────────
  program
    .command('competitive-analysis')
    .alias('compete')
    .description('Deep competitive analysis — research competitors, compare positioning')
    .option('--bg', 'Run in background')
    .action(async (opts) => {
      const workspace = new Workspace(process.cwd());
      if (!await workspace.exists()) {
        console.log(chalk.red('\n  No Brad workspace found. Run "brad init --site <url>" first.\n'));
        return;
      }

      const config = await workspace.loadConfig();
      const llm = createLLM({ provider: config.provider });

      if (opts.bg) {
        // Background mode: fork a child process
        console.log(chalk.cyan('\n  Competitive analysis starting in background...'));
        console.log(chalk.gray('  Brad will search, crawl competitor sites, and build a report.'));
        console.log(chalk.gray('  Check progress: brad findings'));
        console.log(chalk.gray('  This may take 3-5 minutes.\n'));

        const child = fork(
          new URL('../bin/brad.js', import.meta.url).pathname,
          ['competitive-analysis'],
          {
            cwd: process.cwd(),
            detached: true,
            stdio: 'ignore',
            env: { ...process.env },
          }
        );
        child.unref();
        return;
      }

      // Foreground mode with activity log
      console.log(chalk.bold.cyan('\n  Running competitive analysis...\n'));
      console.log(chalk.gray('  This takes 3-5 minutes — Brad will search for competitors,'));
      console.log(chalk.gray('  crawl their sites, and compare positioning.\n'));

      const logLine = (msg) => {
        const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
        console.log(chalk.gray(`  ${ts}`) + `  ${msg}`);
      };

      try {
        const result = await runCompetitiveAnalysis(llm, workspace, { log: logLine });
        console.log(chalk.bold.green('\n  Competitive analysis complete.\n'));
        console.log(result.content + '\n');
      } catch (err) {
        console.log(chalk.red(`\n  Competitive analysis failed: ${err.message}\n`));
      }
    });

  // ── status ─────────────────────────────────────────────────
  program
    .command('status')
    .description('Show workspace status')
    .action(async () => {
      const workspace = new Workspace(process.cwd());
      if (!await workspace.exists()) {
        console.log(chalk.red('\n  No Brad workspace found. Run "brad init --site <url>" first.\n'));
        return;
      }
      console.log(banner(workspace));
      await showStatus(workspace);
    });

  // ── findings ───────────────────────────────────────────────
  program
    .command('findings')
    .description('List all findings and reports')
    .action(async () => {
      const workspace = new Workspace(process.cwd());
      if (!await workspace.exists()) {
        console.log(chalk.red('\n  No Brad workspace found.\n'));
        return;
      }
      const findings = await workspace.listFindings();
      if (findings.length === 0) {
        console.log(chalk.gray('\n  No findings yet. Run "brad audit" or "brad scout".\n'));
      } else {
        console.log('');
        for (const f of findings) {
          console.log(chalk.white(`  ${f}`));
        }
        console.log(chalk.gray(`\n  Run: brad read <filename>\n`));
      }
    });

  // ── read ───────────────────────────────────────────────────
  program
    .command('read <filename>')
    .description('Read a specific finding')
    .action(async (filename) => {
      const workspace = new Workspace(process.cwd());
      if (!await workspace.exists()) {
        console.log(chalk.red('\n  No Brad workspace found.\n'));
        return;
      }
      try {
        const content = await workspace.readFinding(filename);
        console.log('\n' + content + '\n');
      } catch {
        console.log(chalk.red(`\n  Finding not found: ${filename}\n`));
      }
    });

  // ── cleanse ────────────────────────────────────────────────
  program
    .command('cleanse')
    .description('Remove all Brad data (.brad/) from this project')
    .action(async () => {
      const workspace = new Workspace(process.cwd());
      if (!await workspace.exists()) {
        console.log(chalk.yellow('\n  No Brad workspace found in this directory. Nothing to remove.\n'));
        return;
      }

      // Show what will be deleted
      const findings = await workspace.listFindings();
      console.log('');
      console.log(chalk.bold.red('  This will permanently delete:'));
      console.log(chalk.gray(`  ${workspace.bradDir}/`));
      console.log(chalk.gray('  ├── config.json (workspace configuration)'));
      console.log(chalk.gray('  ├── brand-context.json (site analysis)'));
      console.log(chalk.gray(`  ├── findings/ (${findings.length} report${findings.length !== 1 ? 's' : ''})`));
      console.log(chalk.gray('  ├── content/ (drafted posts)'));
      console.log(chalk.gray('  ├── campaigns/'));
      console.log(chalk.gray('  ├── queue/'));
      console.log(chalk.gray('  └── history/ (action log)'));
      console.log('');
      console.log(chalk.white('  No project files will be touched — only .brad/ is removed.'));
      console.log('');

      // Prompt for confirmation
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((resolve) => {
        rl.question(chalk.bold.yellow('  Proceed? (yes/no): '), resolve);
      });
      rl.close();

      if (answer.trim().toLowerCase() !== 'yes') {
        console.log(chalk.gray('\n  Cancelled. Nothing was removed.\n'));
        return;
      }

      const { rm } = await import('fs/promises');
      await rm(workspace.bradDir, { recursive: true, force: true });
      console.log(chalk.green('\n  Done. All Brad data removed from this project.'));
      console.log(chalk.gray('  Run "brad init --site <url>" to start fresh.\n'));
    });

  // ── update ─────────────────────────────────────────────────
  program
    .command('update')
    .description('Update Brad to the latest version')
    .action(async () => {
      const { execSync } = await import('child_process');

      // Find Brad's install directory (where this script lives)
      const bradRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

      console.log(banner(null));
      console.log(chalk.gray(`  Brad install: ${bradRoot}\n`));

      // Check if it's a git repo
      try {
        execSync('git rev-parse --is-inside-work-tree', { cwd: bradRoot, stdio: 'pipe' });
      } catch {
        console.log(chalk.red('  Brad was not installed from git. Update manually:\n'));
        console.log(chalk.white('    cd ' + bradRoot));
        console.log(chalk.white('    git pull && npm install\n'));
        return;
      }

      // Get current version
      const currentVersion = execSync('git rev-parse --short HEAD', { cwd: bradRoot, encoding: 'utf-8' }).trim();
      console.log(chalk.gray(`  Current: ${currentVersion}`));

      // Fetch latest
      console.log(chalk.gray('  Fetching updates...'));
      try {
        execSync('git fetch', { cwd: bradRoot, stdio: 'pipe' });
      } catch (err) {
        console.log(chalk.red(`  Fetch failed: ${err.message}\n`));
        return;
      }

      // Check if we're behind
      const local = execSync('git rev-parse HEAD', { cwd: bradRoot, encoding: 'utf-8' }).trim();
      let remote;
      try {
        remote = execSync('git rev-parse @{u}', { cwd: bradRoot, encoding: 'utf-8' }).trim();
      } catch {
        console.log(chalk.yellow('  No upstream branch configured.'));
        console.log(chalk.gray('  Set one with: git push -u origin <branch>\n'));
        return;
      }

      if (local === remote) {
        console.log(chalk.green('  Already up to date.\n'));
        return;
      }

      // Pull
      console.log(chalk.gray('  Pulling latest...'));
      try {
        const pullOutput = execSync('git pull', { cwd: bradRoot, encoding: 'utf-8' });
        console.log(chalk.gray('  ' + pullOutput.trim().split('\n')[0]));
      } catch (err) {
        console.log(chalk.red(`  Pull failed: ${err.message}`));
        console.log(chalk.yellow('  You may have local changes. Resolve manually:\n'));
        console.log(chalk.white(`    cd ${bradRoot}`));
        console.log(chalk.white('    git stash && git pull && git stash pop\n'));
        return;
      }

      // Install dependencies
      console.log(chalk.gray('  Installing dependencies...'));
      try {
        execSync('npm install --silent', { cwd: bradRoot, stdio: 'pipe' });
      } catch {
        console.log(chalk.yellow('  npm install had warnings (probably fine).'));
      }

      // Re-link
      console.log(chalk.gray('  Re-linking brad command...'));
      try {
        execSync('npm link --silent', { cwd: bradRoot, stdio: 'pipe' });
      } catch {
        // npm link sometimes warns, usually fine
      }

      const newVersion = execSync('git rev-parse --short HEAD', { cwd: bradRoot, encoding: 'utf-8' }).trim();
      console.log(chalk.green(`\n  Updated: ${currentVersion} → ${newVersion}`));
      console.log(chalk.gray(`  Brad v${VERSION}\n`));
    });

  // ── config ─────────────────────────────────────────────────
  program
    .command('config')
    .description('Show current workspace configuration')
    .action(async () => {
      const workspace = new Workspace(process.cwd());
      if (!await workspace.exists()) {
        console.log(chalk.red('\n  No Brad workspace found. Run "brad init --site <url>" first.\n'));
        return;
      }
      const cfg = await workspace.loadConfig();
      console.log('\n' + JSON.stringify(cfg, null, 2) + '\n');
    });

  // ── help ───────────────────────────────────────────────────
  program
    .command('help')
    .description('Show what Brad can do')
    .action(() => {
      console.log(banner(null));
      console.log(chalk.bold('  Setup'));
      console.log('');
      console.log(chalk.white('    brad init --site <url> --name <name>'));
      console.log(chalk.gray('      Scans your project, crawls the site, and builds the full'));
      console.log(chalk.gray('      config — focus paths, brand, keywords, platforms, leads.'));
      console.log(chalk.gray('      Options: --provider openai|anthropic|lana|ollama'));
      console.log(chalk.gray('              --local <url>  (local dev URL)'));
      console.log(chalk.gray('              --skip-analysis (skeleton config only)'));
      console.log('');
      console.log(chalk.white('    /brad  (optional — run in Claude Code)'));
      console.log(chalk.gray('      Claude Code scans the repo for deeper config enrichment.'));
      console.log(chalk.gray('      Better at reading project files, worse at crawling live sites.'));
      console.log('');
      console.log(chalk.bold('  Analysis'));
      console.log(chalk.white('    brad analyze'));
      console.log(chalk.gray('      Re-crawl your site and refresh brand context.'));
      console.log(chalk.gray('      Use after major site changes.'));
      console.log('');
      console.log(chalk.white('    brad audit'));
      console.log(chalk.gray('      Run an SEO audit. Crawls every page, checks meta tags,'));
      console.log(chalk.gray('      headings, content depth, keywords, competitors.'));
      console.log(chalk.gray('      Saves results to .brad/findings/'));
      console.log('');
      console.log(chalk.white('    brad compete'));
      console.log(chalk.gray('      Deep competitive analysis — searches for competitors,'));
      console.log(chalk.gray('      crawls their sites, compares positioning and SEO.'));
      console.log(chalk.gray('      Use --bg to run in background.'));
      console.log('');
      console.log(chalk.white('    brad scout'));
      console.log(chalk.gray('      Scout Reddit for engagement opportunities.'));
      console.log(chalk.gray('      Drafts authentic replies for your review.'));
      console.log('');
      console.log(chalk.bold('  View Results'));
      console.log(chalk.white('    brad config         ') + chalk.gray('Show current config'));
      console.log(chalk.white('    brad findings       ') + chalk.gray('List all findings'));
      console.log(chalk.white('    brad read <file>    ') + chalk.gray('Read a specific finding'));
      console.log(chalk.white('    brad status         ') + chalk.gray('Show workspace overview'));
      console.log('');
      console.log(chalk.bold('  Interactive'));
      console.log(chalk.white('    brad'));
      console.log(chalk.gray('      Launch interactive mode. Ask Brad anything — he has'));
      console.log(chalk.gray('      access to your site crawler, web search, and file tools.'));
      console.log('');
      console.log(chalk.bold('  Maintenance'));
      console.log(chalk.white('    brad cleanse'));
      console.log(chalk.gray('      Remove all Brad data (.brad/). Requires "yes" to confirm.'));
      console.log('');
      console.log(chalk.white('    brad update'));
      console.log(chalk.gray('      Pull latest version, install deps, re-link command.'));
      console.log('');
      console.log(chalk.bold('  Environment'));
      console.log(chalk.gray('    ANTHROPIC_API_KEY   Required for anthropic provider'));
      console.log(chalk.gray('    BRAD_LLM_PROVIDER   Default provider override'));
      console.log(chalk.gray('    OPENAI_API_KEY      Required for openai provider'));
      console.log('');
    });

  // ── Default: interactive mode ──────────────────────────────
  program
    .action(async () => {
      const workspace = new Workspace(process.cwd());
      if (!await workspace.exists()) {
        console.log(banner(null));
        console.log(chalk.yellow('  No workspace found in current directory.'));
        console.log(chalk.white('  Run: brad init --site <url> --name "Your Product"\n'));
        return;
      }
      await interactiveMode(workspace);
    });

  program.parse(argv);
}
