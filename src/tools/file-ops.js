/**
 * File Operations Tool — read/write findings, content, and project files
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readFile, writeFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';

/**
 * Creates file tools scoped to a specific workspace
 */
export function createFileTools(workspace) {
  const saveFinding = tool(
    async ({ filename, content }) => {
      const path = await workspace.saveFinding(filename, content);
      return `Finding saved to ${path}`;
    },
    {
      name: 'save_finding',
      description: 'Save an SEO audit finding, analytics report, or analysis to the .brad/findings/ directory as a markdown file.',
      schema: z.object({
        filename: z.string().describe('Filename ending in .md (e.g., 2026-03-16-seo-audit.md)'),
        content: z.string().describe('The markdown content of the finding'),
      }),
    }
  );

  const saveContent = tool(
    async ({ platform, filename, content }) => {
      const path = await workspace.saveContent(platform, filename, content);
      return `Content saved to ${path}`;
    },
    {
      name: 'save_content',
      description: 'Save drafted social media content to .brad/content/<platform>/ for review before posting.',
      schema: z.object({
        platform: z.enum(['reddit', 'twitter', 'blog']).describe('Target platform'),
        filename: z.string().describe('Filename (e.g., 2026-03-16-r-legaltech-reply.md)'),
        content: z.string().describe('The drafted content'),
      }),
    }
  );

  const readProjectFile = tool(
    async ({ path }) => {
      try {
        const fullPath = resolve(workspace.projectDir, path);
        // Security: ensure we stay within the project directory
        if (!fullPath.startsWith(workspace.projectDir)) {
          return 'Error: path escapes project directory';
        }
        const content = await readFile(fullPath, 'utf-8');
        return content.substring(0, 10000);
      } catch (err) {
        return `Error reading file: ${err.message}`;
      }
    },
    {
      name: 'read_project_file',
      description: 'Read a file from the project directory. Useful for reading docs, configs, page templates, or SEO strategy files.',
      schema: z.object({
        path: z.string().describe('Relative path within the project (e.g., docs/seo/LANA_AI_SEO_STRATEGY.md)'),
      }),
    }
  );

  const listDirectory = tool(
    async ({ path }) => {
      try {
        const fullPath = resolve(workspace.projectDir, path || '.');
        if (!fullPath.startsWith(workspace.projectDir)) {
          return 'Error: path escapes project directory';
        }
        const entries = await readdir(fullPath, { withFileTypes: true });
        const result = entries
          .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
          .map(e => e.isDirectory() ? `${e.name}/` : e.name);
        return result.join('\n');
      } catch (err) {
        return `Error listing directory: ${err.message}`;
      }
    },
    {
      name: 'list_directory',
      description: 'List files and directories in the project. Useful for understanding project structure.',
      schema: z.object({
        path: z.string().nullable().default('.').describe('Relative path within the project (default: root)'),
      }),
    }
  );

  return [saveFinding, saveContent, readProjectFile, listDirectory];
}
