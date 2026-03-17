/**
 * Workspace — initializes and manages .brad/ directory in the target project
 */

import { readFile, writeFile, mkdir, access, readdir } from 'fs/promises';
import { join, resolve } from 'path';

const BRAD_DIR = '.brad';
const CONFIG_FILE = 'config.json';
const BRAND_FILE = 'brand-context.json';

const DEFAULT_CONFIG = {
  version: '0.1.0',
  sites: [],
  focus: [],
  provider: 'openai',
  platforms: {
    reddit: { subreddits: [], enabled: false },
    twitter: { handle: '', enabled: false },
    hackernews: { keywords: [], enabled: false },
  },
  brand: {
    voice: '',
    audience: '',
    differentiators: [],
  },
  schedule: {
    audit: '0 6 * * *',
    engage: '0 8,14 * * *',
    content: '0 7 * * 1,3,5',
  },
  approval: 'require',
};

export class Workspace {
  constructor(projectDir) {
    this.projectDir = resolve(projectDir);
    this.bradDir = join(this.projectDir, BRAD_DIR);
    this.configPath = join(this.bradDir, CONFIG_FILE);
    this.brandPath = join(this.bradDir, BRAND_FILE);
  }

  async exists() {
    try {
      await access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  async init(options = {}) {
    const dirs = [
      this.bradDir,
      join(this.bradDir, 'findings'),
      join(this.bradDir, 'content', 'reddit'),
      join(this.bradDir, 'content', 'twitter'),
      join(this.bradDir, 'content', 'blog'),
      join(this.bradDir, 'campaigns'),
      join(this.bradDir, 'queue'),
      join(this.bradDir, 'history'),
    ];

    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
    }

    const config = { ...DEFAULT_CONFIG };
    if (options.site) {
      config.sites.push({
        name: options.name || 'My Site',
        url: options.site,
        local: options.local || null,
        analytics: { ga4: options.ga4 || null },
      });
    }
    if (options.provider) {
      config.provider = options.provider;
    }
    if (options.focus?.length) {
      config.focus = options.focus;
    }

    await writeFile(this.configPath, JSON.stringify(config, null, 2));
    return config;
  }

  async loadConfig() {
    const raw = await readFile(this.configPath, 'utf-8');
    return JSON.parse(raw);
  }

  async saveConfig(config) {
    await writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  async loadBrandContext() {
    try {
      const raw = await readFile(this.brandPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async saveBrandContext(context) {
    await writeFile(this.brandPath, JSON.stringify(context, null, 2));
  }

  async saveFinding(filename, content) {
    const path = join(this.bradDir, 'findings', filename);
    await writeFile(path, content);
    return path;
  }

  async saveContent(platform, filename, content) {
    const path = join(this.bradDir, 'content', platform, filename);
    await writeFile(path, content);
    return path;
  }

  async listFindings() {
    try {
      const files = await readdir(join(this.bradDir, 'findings'));
      return files.filter(f => f.endsWith('.md')).sort().reverse();
    } catch {
      return [];
    }
  }

  async readFinding(filename) {
    return readFile(join(this.bradDir, 'findings', filename), 'utf-8');
  }

  async appendHistory(entry) {
    const path = join(this.bradDir, 'history', 'actions.jsonl');
    const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
    await writeFile(path, line, { flag: 'a' });
  }

  /**
   * Scan the project directory for useful context files.
   * If focus paths are configured, only scan those directories/files.
   */
  async scanProject() {
    const config = await this.loadConfig().catch(() => null);
    const focusPaths = config?.focus || [];

    if (focusPaths.length > 0) {
      return this._scanFocusedPaths(focusPaths);
    }
    return this._scanDirectory(this.projectDir);
  }

  async _scanFocusedPaths(focusPaths) {
    const results = [];
    for (const fp of focusPaths) {
      const fullPath = join(this.projectDir, fp);
      try {
        const stat = await import('fs/promises').then(fs => fs.stat(fullPath));
        if (stat.isDirectory()) {
          const files = await this._scanDirectory(fullPath);
          results.push(...files.map(f => `${fp}/${f}`));
        } else {
          results.push(fp);
        }
      } catch {
        // Focus path doesn't exist, skip
      }
    }
    return results;
  }

  async _scanDirectory(dirPath) {
    const interesting = [];
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      if (entry.isFile()) {
        const ext = entry.name.split('.').pop().toLowerCase();
        if (['md', 'txt', 'json', 'html', 'ejs', 'yml', 'yaml', 'js', 'css'].includes(ext)) {
          interesting.push(entry.name);
        }
      } else if (entry.isDirectory()) {
        interesting.push(entry.name + '/');
      }
    }

    return interesting;
  }
}
