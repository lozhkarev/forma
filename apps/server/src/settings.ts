import { randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDoc } from '@forma/core';
import { VaultError, type VaultService } from './vault.js';

export interface McpConfig {
  mcpServers: Record<string, unknown>;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

function safeName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new VaultError(`invalid server name: ${name}`, 400);
  }
  return name;
}

/**
 * Reads/writes `.claude/mcp.json` (MCP server registry) and lists the skills
 * under `.claude/skills`. Secrets belong in env vars referenced from the
 * config, not stored here.
 */
export class SettingsService {
  private mcpPath: string;
  private skillsDir: string;

  constructor(vault: VaultService) {
    this.mcpPath = path.join(vault.root, '.claude', 'mcp.json');
    this.skillsDir = path.join(vault.root, '.claude', 'skills');
  }

  async readMcp(): Promise<McpConfig> {
    let raw: string;
    try {
      raw = await fs.readFile(this.mcpPath, 'utf8');
    } catch {
      return { mcpServers: {} };
    }
    try {
      const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
      return { mcpServers: parsed.mcpServers ?? {} };
    } catch {
      throw new VaultError('mcp.json is not valid JSON — fix it manually', 400);
    }
  }

  async putServer(name: string, config: unknown): Promise<McpConfig> {
    safeName(name);
    const cfg = await this.readMcp();
    cfg.mcpServers[name] = config;
    await this.write(cfg);
    return cfg;
  }

  async deleteServer(name: string): Promise<McpConfig> {
    const cfg = await this.readMcp();
    delete cfg.mcpServers[safeName(name)];
    await this.write(cfg);
    return cfg;
  }

  private async write(cfg: McpConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.mcpPath), { recursive: true });
    const tmp = path.join(path.dirname(this.mcpPath), `.${randomBytes(6).toString('hex')}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, this.mcpPath);
  }

  async listSkills(): Promise<SkillInfo[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const skills: SkillInfo[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const raw = await fs.readFile(path.join(this.skillsDir, e.name, 'SKILL.md'), 'utf8');
        const { frontmatter } = parseDoc(raw);
        skills.push({
          name: typeof frontmatter['name'] === 'string' ? frontmatter['name'] : e.name,
          description: typeof frontmatter['description'] === 'string' ? frontmatter['description'] : '',
          path: `.claude/skills/${e.name}/SKILL.md`,
        });
      } catch {
        // a directory without a SKILL.md — skip
      }
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return skills;
  }
}
