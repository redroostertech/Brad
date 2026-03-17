/**
 * Agent — LangGraph ReAct agent orchestrator
 * The "CMO brain" that reasons about what to do and calls tools
 */

import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

/**
 * Create a Brad agent with the given LLM and tools
 * @param {BaseChatModel} llm
 * @param {Array} tools - LangGraph tool definitions
 * @param {object} options
 * @param {string} options.systemPrompt - system prompt override
 * @param {object} options.brandContext - brand context to inject
 * @returns {CompiledGraph}
 */
export function createBradAgent(llm, tools, options = {}) {
  const systemPrompt = options.systemPrompt || buildSystemPrompt(options.brandContext, options.config);

  const agent = createReactAgent({
    llm,
    tools,
    messageModifier: new SystemMessage(systemPrompt),
  });

  return agent;
}

function buildSystemPrompt(brandContext, config) {
  let prompt = `You are Brad, an autonomous AI Chief Marketing Officer. You analyze websites, audit SEO, monitor social platforms, create content, and drive growth for startups.

You are methodical, data-driven, and authentic. You never write spammy or salesy content. You lead with the problem, never the product. You engage in communities as a genuine participant who happens to have relevant expertise.

Your workflow:
1. OBSERVE — Crawl the website, pull analytics, scan social platforms for relevant discussions
2. ANALYZE — Identify SEO issues, content gaps, engagement opportunities
3. PLAN — Draft content, replies, and site improvement recommendations
4. REPORT — Write findings as structured markdown
5. EXECUTE — When approved, post content and trigger site edits

CRITICAL RULES:
- Only report what you actually observe from tool calls. Never fabricate data.
- If you didn't see it in a tool result, label it as [Inference] or don't include it.
- Always use the read_project_file tool to read context_files listed below before making recommendations.
- Always output structured, actionable findings with markdown formatting.
- When writing social media content, match the tone and norms of each platform.`;

  // ── Brand Context (from brand-context.json) ──
  if (brandContext) {
    prompt += `\n\n## Brand Context\n`;
    if (brandContext.name) prompt += `- **Company**: ${brandContext.name}\n`;
    if (brandContext.url) prompt += `- **Website**: ${brandContext.url}\n`;
    if (brandContext.valueProposition) prompt += `- **Value Prop**: ${brandContext.valueProposition}\n`;
    if (brandContext.audience) prompt += `- **Target Audience**: ${brandContext.audience}\n`;
    if (brandContext.voice) prompt += `- **Brand Voice**: ${brandContext.voice}\n`;
    if (brandContext.differentiators?.length) {
      prompt += `- **Key Differentiators**:\n`;
      brandContext.differentiators.forEach(d => { prompt += `  - ${d}\n`; });
    }
  }

  // ── Full Config (from .brad/config.json) ──
  if (config) {
    // Brand details from config (richer than brand-context.json)
    const brand = config.brand;
    if (brand) {
      if (brand.voice && !brandContext?.voice) prompt += `- **Brand Voice**: ${brand.voice}\n`;
      if (brand.audience && !brandContext?.audience) prompt += `- **Target Audience**: ${brand.audience}\n`;
      if (brand.differentiators?.length && !brandContext?.differentiators?.length) {
        prompt += `- **Key Differentiators**:\n`;
        brand.differentiators.forEach(d => { prompt += `  - ${d}\n`; });
      }
      if (brand.competitors?.length) {
        prompt += `- **Known Competitors**: ${brand.competitors.join(', ')}\n`;
      }
      if (brand.keywords) {
        if (brand.keywords.primary?.length) {
          prompt += `- **Primary Keywords**: ${brand.keywords.primary.join(', ')}\n`;
        }
        if (brand.keywords.secondary?.length) {
          prompt += `- **Secondary Keywords**: ${brand.keywords.secondary.join(', ')}\n`;
        }
        if (brand.keywords.long_tail?.length) {
          prompt += `- **Long-tail Keywords**: ${brand.keywords.long_tail.join(', ')}\n`;
        }
      }
    }

    // Platforms
    const platforms = config.platforms;
    if (platforms) {
      prompt += `\n## Active Platforms\n`;
      if (platforms.reddit?.enabled) {
        prompt += `- **Reddit**: Monitoring r/${platforms.reddit.subreddits.join(', r/')}\n`;
      }
      if (platforms.hackernews?.enabled) {
        prompt += `- **Hacker News**: Watching for: ${platforms.hackernews.keywords.join(', ')}\n`;
      }
      if (platforms.twitter?.enabled) {
        prompt += `- **Twitter/X**: ${platforms.twitter.handle || '(no handle set)'} | Hashtags: ${platforms.twitter.hashtags?.join(', ') || 'none'}\n`;
      }
    }

    // Lead data
    if (config.lead_data) {
      prompt += `\n## Lead Intelligence\n`;
      prompt += `- **Target Markets**: ${config.lead_data.markets?.join(', ') || 'Not set'}\n`;
      prompt += `- **Practice Areas**: ${config.lead_data.practice_areas?.join(', ') || 'Not set'}\n`;
      prompt += `- **Lead Sources Available**: ${config.lead_data.sources?.length || 0} files in the project (use read_project_file to access)\n`;
    }

    // Context files the agent should read for deeper understanding
    if (config.context_files?.length) {
      prompt += `\n## Context Files (READ THESE for deeper product understanding)\n`;
      prompt += `Use the read_project_file tool to read these files when you need product details, SEO strategy, or marketing context:\n`;
      config.context_files.forEach(f => { prompt += `- ${f}\n`; });
    }

    // Focus paths
    if (config.focus?.length) {
      prompt += `\n## Project Focus\n`;
      prompt += `When reading project files, focus on these paths:\n`;
      config.focus.forEach(f => { prompt += `- ${f}\n`; });
    }
  }

  return prompt;
}

/**
 * Run the agent with a message and return the final response.
 * @param {CompiledGraph} agent
 * @param {string} message
 * @param {object} options
 * @param {function} options.onToolCall - callback(toolName, toolInput) for activity logging
 * @param {function} options.onToolResult - callback(toolName) when tool finishes
 */
export async function runAgent(agent, message, options = {}) {
  const input = {
    messages: [new HumanMessage(message)],
  };

  const onToolCall = options.onToolCall || (() => {});
  const onToolResult = options.onToolResult || (() => {});

  let lastContent = '';
  let toolCallCount = 0;

  // Stream so we can observe tool calls in real-time
  const stream = await agent.stream(input, { streamMode: 'updates' });

  for await (const event of stream) {
    // Tool calls from the agent node
    if (event.agent?.messages) {
      for (const msg of event.agent.messages) {
        if (msg.additional_kwargs?.tool_calls) {
          for (const tc of msg.additional_kwargs.tool_calls) {
            toolCallCount++;
            const name = tc.function?.name || 'unknown';
            let args = {};
            try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}
            onToolCall(name, args);
          }
        }
        if (msg.content && typeof msg.content === 'string') {
          lastContent = msg.content;
        }
      }
    }

    // Tool results
    if (event.tools?.messages) {
      for (const msg of event.tools.messages) {
        onToolResult(msg.name || 'unknown');
      }
    }
  }

  return {
    content: lastContent,
    toolCalls: toolCallCount,
  };
}

/**
 * Stream the agent's response for interactive mode
 */
export async function* streamAgent(agent, message) {
  const input = {
    messages: [new HumanMessage(message)],
  };

  for await (const event of await agent.stream(input, { streamMode: 'updates' })) {
    yield event;
  }
}
