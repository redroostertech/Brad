# Contributing to Brad

Thanks for your interest in contributing to Brad — Brand Reach Automation & Distribution.

## Getting Started

### Prerequisites

- Node.js 20+
- Git
- An LLM API key (OpenAI, Anthropic, or a local Ollama/LANA instance)

### Setup

```bash
git clone git@github.com:redroostertech/Brad.git
cd Brad
npm install
npm link
```

This links `brad` as a global command pointing to your local source. Any changes you make are immediately reflected.

### Verify

```bash
brad --version
brad help
```

### Test in a project

```bash
cd ~/some-project
export OPENAI_API_KEY=sk-your-key
brad init --site https://example.com --name "Test" --skip-analysis
brad status
```

---

## Project Structure

```
brad/
├── bin/brad.js                     # CLI entry point (shebang, max listeners)
├── src/
│   ├── cli.js                      # Command router, interactive REPL, helpers
│   ├── core/
│   │   ├── agent.js                # LangGraph ReAct agent + streaming tool calls
│   │   ├── llm.js                  # Multi-provider LLM factory
│   │   └── workspace.js            # .brad/ directory management
│   ├── agents/                     # Each agent is a self-contained prompt + runner
│   │   ├── competitive-analysis.js
│   │   ├── reddit-agent.js
│   │   ├── seo-auditor.js
│   │   └── site-analyzer.js
│   ├── tools/                      # LangGraph tool definitions (Zod schemas)
│   │   ├── file-ops.js
│   │   ├── search.js
│   │   └── web-crawler.js
│   └── config/
│       ├── defaults.js
│       └── prompts/
│           └── reddit-persona.md
├── skill/SKILL.md                  # Claude Code /brad skill
├── install.sh
├── setup.sh
├── .env.example
├── LICENSE
└── README.md
```

### Key Concepts

**Agents** (`src/agents/`) — Each agent is a function that creates a LangGraph ReAct agent with a specific system prompt and tool set. The agent loop (tool calling, reasoning, output) is handled by LangGraph. Your job is crafting the prompt and choosing the right tools.

**Tools** (`src/tools/`) — LangGraph tool definitions using `@langchain/core/tools` and Zod schemas. Tools are the actions agents can take: crawl pages, search the web, read/write files.

**Core** (`src/core/`) — Shared infrastructure:
- `llm.js` — Factory that creates the right LLM client based on provider config
- `agent.js` — Creates the ReAct agent, handles streaming with `onToolCall`/`onToolResult` callbacks
- `workspace.js` — Manages the `.brad/` directory (config, findings, content, history)

**CLI** (`src/cli.js`) — Commander.js commands + interactive REPL. Each command loads the workspace, creates an LLM, runs an agent, and renders output. Shared helpers: `createLogger()` for timestamped output, `enableAbort()` for double-ESC.

---

## Adding a New Agent

This is the most common contribution. Follow this pattern:

### 1. Create the agent file

```bash
touch src/agents/my-agent.js
```

```javascript
import { createBradAgent, runAgent } from '../core/agent.js';
import { webSearch } from '../tools/search.js';
import { createFileTools } from '../tools/file-ops.js';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

const PROMPT = (siteName, brandContext, config) => `
You are conducting [analysis type] for ${siteName}.

## Brand Context
${brandContext?.valueProposition || ''}

## Steps
1. [What to do first — be specific about which tools to use]
2. [Next step]
3. [Save findings]

## Output
Save finding as "${todayStr()}-my-analysis.md" containing:
[Specify the exact format you want]

## Rules
- Only report what you observe from tool calls
- [Other constraints]
`;

export async function runMyAgent(llm, workspace, options = {}) {
  const log = options.log || (() => {});
  const config = await workspace.loadConfig();
  const site = config.sites[0];
  const brandContext = await workspace.loadBrandContext();
  const fileTools = createFileTools(workspace);
  const tools = [webSearch, ...fileTools];

  log(`Starting analysis for ${site.name}...`);
  const agent = createBradAgent(llm, tools, { brandContext, config });

  const result = await runAgent(agent, PROMPT(site.name, brandContext, config), {
    onToolCall: (name, args) => log(`Calling: ${name}`),
    onToolResult: (name) => log(`  Done: ${name}`),
  });

  await workspace.appendHistory({
    action: 'my_analysis',
    site: site.url,
    date: todayStr(),
    toolCalls: result.toolCalls,
  });

  return result;
}
```

### 2. Wire it into the CLI

In `src/cli.js`:

```javascript
// Add import at top
import { runMyAgent } from './agents/my-agent.js';

// Add command (alphabetical order within its section)
program
  .command('my-command')
  .description('Description here')
  .action(async () => {
    const workspace = new Workspace(process.cwd());
    if (!await workspace.exists()) {
      console.log(chalk.red('\n  No Brad workspace found.\n'));
      return;
    }

    const config = await workspace.loadConfig();
    const llm = createLLM({ provider: config.provider });

    console.log(chalk.bold.cyan('\n  Running analysis...'));
    console.log(chalk.gray('  Press ESC twice to abort.\n'));

    const cleanup = enableAbort();
    const log = createLogger();
    try {
      const result = await runMyAgent(llm, workspace, { log });
      cleanup();
      console.log(chalk.bold.green('\n  Done.\n'));
      console.log(result.content + '\n');
    } catch (err) {
      cleanup();
      console.log(chalk.red(`\n  Failed: ${err.message}\n`));
    }
  });
```

### 3. Add to interactive mode

In the `switch` block inside `interactiveMode()`:

```javascript
case 'my-command': {
  // same pattern as above but use getLLM() instead of createLLM()
  break;
}
```

### 4. Add to help

Update both `printHelp()` (interactive mode) and the `help` command. Keep alphabetical order within each section.

---

## Adding a New Tool

### 1. Create the tool

```javascript
// src/tools/my-tool.js
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const myTool = tool(
  async ({ param1, param2 }) => {
    // Do the work
    return JSON.stringify({ result: 'data' });
  },
  {
    name: 'my_tool',
    description: 'What this tool does. Be specific — the LLM reads this.',
    schema: z.object({
      param1: z.string().describe('What this parameter is'),
      param2: z.number().nullable().default(10).describe('Optional with default'),
    }),
  }
);
```

### 2. Use it in an agent

```javascript
import { myTool } from '../tools/my-tool.js';

// Add to tools array
const tools = [myTool, webSearch, ...fileTools];
```

### Tool Guidelines

- Return JSON strings, not objects — LangGraph serializes tool results as strings
- Use `.nullable().default(value)` instead of `.optional()` for optional params (OpenAI API requirement)
- Keep tool descriptions clear — the LLM decides which tools to call based on these
- Handle errors gracefully — return `{ error: message }` instead of throwing

---

## Adding a New LLM Provider

In `src/core/llm.js`:

```javascript
function createMyProvider(config) {
  const apiKey = config.apiKey || process.env.MY_PROVIDER_KEY;
  if (!apiKey) {
    throw new Error('MY_PROVIDER_KEY not found.\n\n  export MY_PROVIDER_KEY=your-key\n');
  }
  return new ChatMyProvider({
    model: config.model || process.env.MY_PROVIDER_MODEL || 'default-model',
    apiKey,
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens || 4096,
  });
}

// Add to PROVIDERS map
const PROVIDERS = {
  openai: createOpenAI,
  anthropic: createAnthropic,
  lana: createLana,
  ollama: createOllama,
  myprovider: createMyProvider,  // new
};
```

Update `.env.example`, `README.md`, and `brad help` output.

---

## Code Conventions

### General

- ES modules (`import/export`), not CommonJS
- No TypeScript (vanilla JS with JSDoc where helpful)
- No regex pattern matching for string operations — use `includes()`, `startsWith()`, `split()`, etc.
- Zod for all schemas

### Naming

- Files: `kebab-case.js`
- Functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Tool names: `snake_case` (LangGraph convention)
- Commands: `kebab-case` in CLI, alphabetized in help

### CLI Patterns

- Every long-running command gets `enableAbort()` + `createLogger()`
- Every command checks `workspace.exists()` before proceeding
- Error messages include what to do next
- No spinners — use timestamped activity logs

### Agent Prompts

- Be explicit about which tools to call and in what order
- Use Plan/Execute/Verify structure for complex tasks
- Tell the LLM what NOT to do (no shortcuts, no fabrication)
- Include the expected output format in the prompt
- Reference brand context and config keywords in the prompt

### Git

- Branch from `development`
- One feature per branch
- Commit messages: imperative mood, explain what and why
- `Co-Authored-By` trailer if AI-assisted

---

## Branching Strategy

```
main              ← Production releases only (protected, 2 approvals)
  └── development ← Integration branch (protected, 1 approval)
        ├── feature/add-twitter-agent
        ├── feature/ga4-integration
        ├── fix/crawl-site-timeout
        └── docs/update-readme
```

### Rules

- **Never push directly to `main` or `development`** — always use pull requests
- **Branch from `development`** for all work
- **Name branches**: `feature/description`, `fix/description`, `docs/description`
- **PR into `development`** — requires 1 approval
- **PR from `development` into `main`** — requires 2 approvals (release only)
- **Delete branches after merge**

### Workflow

```bash
# Start new work
git checkout development
git pull
git checkout -b feature/my-feature

# Do your work, commit
git add -A
git commit -m "Add my feature"

# Push and create PR
git push -u origin feature/my-feature
gh pr create --base development
```

---

## Pull Request Checklist

- [ ] Code runs without errors (`node -c src/your-file.js`)
- [ ] `brad help` output is alphabetized and includes your new command
- [ ] New commands have `enableAbort()` and `createLogger()`
- [ ] New tools use `.nullable().default()` for optional params
- [ ] Agent prompts include Plan/Execute/Verify for multi-step tasks
- [ ] README updated if adding commands, flags, or env vars
- [ ] Tested with at least one LLM provider

---

## Architecture Decisions

### Why LangGraph over raw OpenAI SDK?

Provider switching. Brad supports 4 LLM backends. LangGraph's `createReactAgent` handles the tool loop identically regardless of provider. Swapping OpenAI for Anthropic is one line.

### Why Cheerio over Puppeteer for crawling?

Speed and simplicity. Most marketing pages are server-rendered HTML. Cheerio parses in milliseconds without launching a browser. Puppeteer is a dependency for future JS-rendered page support but not used in the default crawl tools.

### Why flat files over a database?

Brad runs in project directories like a linter. Findings are markdown files you can read, commit, and diff. No server process, no migrations, no connection strings.

### Why streaming tool calls?

Visibility. Users need to see what Brad is doing during 2-5 minute operations. The `onToolCall`/`onToolResult` callbacks in `runAgent()` feed the timestamped activity log in real-time.

---

## Questions?

Open an issue at [github.com/redroostertech/Brad/issues](https://github.com/redroostertech/Brad/issues).
