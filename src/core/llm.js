/**
 * LLM Factory — multi-backend provider switching
 * Supports: OpenAI, Anthropic, LANA-AI (local), Ollama
 */

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';

const PROVIDERS = {
  openai: createOpenAI,
  anthropic: createAnthropic,
  lana: createLana,
  ollama: createOllama,
};

function createOpenAI(config) {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key not found. Set OPENAI_API_KEY environment variable:\n\n  export OPENAI_API_KEY=sk-your-key\n');
  }
  return new ChatOpenAI({
    model: config.model || process.env.OPENAI_MODEL || 'gpt-4o',
    apiKey,
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens || 4096,
  });
}

function createAnthropic(config) {
  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API key not found. Set ANTHROPIC_API_KEY environment variable:\n\n  export ANTHROPIC_API_KEY=sk-ant-your-key\n');
  }
  return new ChatAnthropic({
    model: config.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    apiKey,
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens || 4096,
  });
}

function createLana(config) {
  return new ChatOpenAI({
    model: config.model || process.env.LANA_MODEL || 'lana-default',
    apiKey: config.apiKey || process.env.LANA_API_TOKEN || 'local',
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens || 4096,
    configuration: {
      baseURL: config.baseURL || process.env.LANA_API_URL || 'http://localhost:8080/api/v1',
    },
  });
}

function createOllama(config) {
  return new ChatOllama({
    model: config.model || process.env.OLLAMA_MODEL || 'llama3.1:8b',
    baseUrl: config.baseURL || process.env.OLLAMA_URL || 'http://localhost:11434',
    temperature: config.temperature ?? 0.7,
  });
}

/**
 * Create an LLM instance from config or environment
 * @param {object} options
 * @param {string} options.provider - openai | anthropic | lana | ollama
 * @param {string} options.model - model name override
 * @param {number} options.temperature
 * @param {number} options.maxTokens
 * @returns {BaseChatModel}
 */
export function createLLM(options = {}) {
  const provider = options.provider || process.env.BRAD_LLM_PROVIDER || 'openai';
  const factory = PROVIDERS[provider];

  if (!factory) {
    const supported = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unknown LLM provider "${provider}". Supported: ${supported}`);
  }

  return factory(options);
}

export function listProviders() {
  return Object.keys(PROVIDERS);
}
