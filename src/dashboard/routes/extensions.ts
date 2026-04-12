/**
 * Dashboard API routes for extension management — MCP servers and skills.
 */

import { Hono } from 'hono';
import {
  listAllMcpExtensions,
  addGlobalMcpExtension, removeGlobalMcpExtension, updateGlobalMcpExtension,
  addWorkspaceMcpExtension, removeWorkspaceMcpExtension, updateWorkspaceMcpExtension,
  checkMcpHealth,
  listSkills,
  getRecommendedMcpServers, getRecommendedSkillRepos,
  searchMcpServers, searchSkillRepos,
  installSkill, removeSkill,
} from '../../agent/index.js';
import type { McpServerConfig } from '../../core/config/user-config.js';
import { runtime } from '../runtime.js';
import path from 'node:path';
import fs from 'node:fs';

const app = new Hono();

/** Validate that a workdir is an existing absolute directory path. */
function isValidWorkdir(dir: string | undefined | null): dir is string {
  if (!dir || typeof dir !== 'string') return false;
  if (!path.isAbsolute(dir)) return false;
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}

// ---------------------------------------------------------------------------
// MCP Extensions
// ---------------------------------------------------------------------------

/** GET /api/extensions/mcp — List all MCP extensions (global + workspace). */
app.get('/api/extensions/mcp', (c) => {
  const workdir = c.req.query('workdir') || runtime.getRequestWorkdir();
  const extensions = listAllMcpExtensions(workdir);
  return c.json({ ok: true, extensions });
});

/** POST /api/extensions/mcp/add — Add an MCP extension. */
app.post('/api/extensions/mcp/add', async (c) => {
  try {
    const body = await c.req.json();
    const { name, config, scope, workdir: reqWorkdir } = body as {
      name: string;
      config: McpServerConfig;
      scope: 'global' | 'workspace';
      workdir?: string;
    };
    if (!name?.trim()) return c.json({ ok: false, error: 'name is required' }, 400);
    if (!config) return c.json({ ok: false, error: 'config is required' }, 400);

    if (scope === 'workspace') {
      const wd = reqWorkdir || runtime.getRequestWorkdir();
      if (!isValidWorkdir(wd)) return c.json({ ok: false, error: 'valid workdir is required for workspace scope' }, 400);
      addWorkspaceMcpExtension(wd, name.trim(), config);
    } else {
      addGlobalMcpExtension(name.trim(), config);
    }
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || 'internal error' }, 500);
  }
});

/** POST /api/extensions/mcp/remove — Remove an MCP extension. */
app.post('/api/extensions/mcp/remove', async (c) => {
  try {
    const body = await c.req.json();
    const { name, scope, workdir: reqWorkdir } = body as {
      name: string;
      scope: 'global' | 'workspace';
      workdir?: string;
    };
    if (!name?.trim()) return c.json({ ok: false, error: 'name is required' }, 400);

    let removed: boolean;
    if (scope === 'workspace') {
      const wd = reqWorkdir || runtime.getRequestWorkdir();
      if (!isValidWorkdir(wd)) return c.json({ ok: false, error: 'valid workdir is required' }, 400);
      removed = removeWorkspaceMcpExtension(wd, name.trim());
    } else {
      removed = removeGlobalMcpExtension(name.trim());
    }
    return c.json({ ok: true, removed });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || 'internal error' }, 500);
  }
});

/** POST /api/extensions/mcp/update — Update an MCP extension config. */
app.post('/api/extensions/mcp/update', async (c) => {
  try {
    const body = await c.req.json();
    const { name, patch, scope, workdir: reqWorkdir } = body as {
      name: string;
      patch: Partial<McpServerConfig>;
      scope: 'global' | 'workspace';
      workdir?: string;
    };
    if (!name?.trim()) return c.json({ ok: false, error: 'name is required' }, 400);

    let updated: boolean;
    if (scope === 'workspace') {
      const wd = reqWorkdir || runtime.getRequestWorkdir();
      if (!isValidWorkdir(wd)) return c.json({ ok: false, error: 'valid workdir is required' }, 400);
      updated = updateWorkspaceMcpExtension(wd, name.trim(), patch);
    } else {
      updated = updateGlobalMcpExtension(name.trim(), patch);
    }
    return c.json({ ok: true, updated });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || 'internal error' }, 500);
  }
});

/** POST /api/extensions/mcp/health — Check an MCP server health. */
app.post('/api/extensions/mcp/health', async (c) => {
  try {
    const body = await c.req.json();
    const { config } = body as { config: McpServerConfig };
    if (!config) return c.json({ ok: false, error: 'config is required' }, 400);
    const result = await checkMcpHealth(config);
    return c.json(result);
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || 'internal error' }, 500);
  }
});

/** GET /api/extensions/mcp/recommended — Get recommended MCP servers. */
app.get('/api/extensions/mcp/recommended', (c) => {
  return c.json({ ok: true, servers: getRecommendedMcpServers() });
});

/** GET /api/extensions/mcp/search — Search community MCP servers. */
app.get('/api/extensions/mcp/search', async (c) => {
  const query = c.req.query('q') || '';
  const parsed = parseInt(c.req.query('limit') || '20', 10);
  const limit = Math.min(Number.isFinite(parsed) ? parsed : 20, 50);
  try {
    const results = await searchMcpServers(query, limit);
    return c.json({ ok: true, results });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message, results: [] });
  }
});

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/** GET /api/extensions/skills — List all installed skills (project + global). */
app.get('/api/extensions/skills', (c) => {
  const workdir = c.req.query('workdir') || runtime.getRequestWorkdir();
  if (!workdir) return c.json({ ok: false, error: 'workdir is required', skills: [] }, 400);
  const result = listSkills(workdir);
  return c.json({ ok: true, skills: result.skills });
});

/** POST /api/extensions/skills/install — Install a skill via npx skills add. */
app.post('/api/extensions/skills/install', async (c) => {
  try {
    const body = await c.req.json();
    const { source, global: isGlobal, skill, workdir: reqWorkdir } = body as {
      source: string;
      global?: boolean;
      skill?: string;
      workdir?: string;
    };
    if (!source?.trim()) return c.json({ ok: false, error: 'source is required' }, 400);

    const workdir = reqWorkdir || runtime.getRequestWorkdir();
    if (!isGlobal && !isValidWorkdir(workdir)) {
      return c.json({ ok: false, error: 'valid workdir is required for project-scoped install' }, 400);
    }

    const result = await installSkill(source.trim(), { global: isGlobal, skill, workdir });
    return c.json(result);
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || 'installation failed' }, 500);
  }
});

/** POST /api/extensions/skills/remove — Remove an installed skill. */
app.post('/api/extensions/skills/remove', async (c) => {
  try {
    const body = await c.req.json();
    const { name, global: isGlobal, workdir: reqWorkdir } = body as {
      name: string;
      global?: boolean;
      workdir?: string;
    };
    if (!name?.trim()) return c.json({ ok: false, error: 'name is required' }, 400);

    const workdir = reqWorkdir || runtime.getRequestWorkdir();
    const result = removeSkill(name.trim(), { global: isGlobal, workdir });
    return c.json(result);
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || 'removal failed' }, 500);
  }
});

/** GET /api/extensions/skills/recommended — Get recommended skill repos. */
app.get('/api/extensions/skills/recommended', (c) => {
  return c.json({ ok: true, repos: getRecommendedSkillRepos() });
});

/** GET /api/extensions/skills/search — Search community skills. */
app.get('/api/extensions/skills/search', async (c) => {
  const query = c.req.query('q') || '';
  try {
    const results = await searchSkillRepos(query);
    return c.json({ ok: true, results });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message, results: [] });
  }
});

export default app;
