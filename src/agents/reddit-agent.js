/**
 * Reddit Agent — monitors subreddits, finds relevant threads, drafts authentic replies
 *
 * Phase 1 (PoC): Search-based discovery via web search (no Reddit API needed)
 * Phase 2: Direct Reddit API integration via snoowrap for posting
 */

import { createBradAgent, runAgent } from '../core/agent.js';
import { webSearch } from '../tools/search.js';
import { createFileTools } from '../tools/file-ops.js';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

const REDDIT_SCOUT_PROMPT = (subreddits, brandContext, siteName) => `
You are scouting Reddit for marketing opportunities for ${siteName}.

${brandContext ? `## Brand Context\n${JSON.stringify(brandContext, null, 2)}` : ''}

## Target Subreddits
${subreddits.map(s => `- r/${s}`).join('\n')}

## Your Tasks

1. **Search for recent relevant discussions** on Reddit about topics related to our product.
   Search for queries like:
   - "site:reddit.com ${subreddits[0]} legal AI"
   - "site:reddit.com on-premise AI software"
   - "site:reddit.com law firm document automation"
   - "site:reddit.com AI attorney client privilege"
   (Adapt these to match the actual brand context)

2. **For each relevant thread found**, evaluate:
   - Is it recent (within last 7 days preferred, 30 days max)?
   - Is it a genuine question or discussion (not a rant or locked thread)?
   - Can we add genuine value without being promotional?
   - What's the upvote count / engagement level?

3. **Draft replies** for the top 3 most promising threads.

   Reply guidelines:
   - Lead with expertise and value, NOT the product
   - Answer the question or contribute to the discussion first
   - Only mention the product if directly relevant, and frame it as "I've seen [product] do this" not "Buy [product]"
   - Match Reddit's informal, peer-to-peer tone
   - Include specific technical details that demonstrate real knowledge
   - Keep it under 200 words
   - NEVER use marketing language, emojis, or exclamation marks

4. **Save each draft** as content with platform "reddit" and descriptive filenames.

5. **Save a summary finding** with filename "${todayStr()}-reddit-scout.md" containing:
   - Threads found and relevance scores
   - Drafted replies with target URLs
   - Engagement predictions
   - Subreddit sentiment (is the community receptive to our type of product?)

Be honest in your assessment. If there are no good opportunities today, say so.
Forcing engagement where it doesn't fit is worse than waiting.
`;

export async function scoutReddit(llm, workspace) {
  const config = await workspace.loadConfig();
  const site = config.sites[0];
  const subreddits = config.platforms?.reddit?.subreddits || ['legaltech'];
  const brandContext = await workspace.loadBrandContext();

  const fileTools = createFileTools(workspace);
  const tools = [webSearch, ...fileTools];

  const agent = createBradAgent(llm, tools, { brandContext, config });

  const result = await runAgent(
    agent,
    REDDIT_SCOUT_PROMPT(subreddits, brandContext, site?.name || 'our product')
  );

  await workspace.appendHistory({
    action: 'reddit_scout',
    subreddits,
    date: todayStr(),
    toolCalls: result.toolCalls,
  });

  return result;
}
