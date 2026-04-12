/**
 * MCP extension management — CRUD, health check, merge logic.
 *
 * Global extensions live in ~/.pikiclaw/setting.json under extensions.mcp.
 * Workspace extensions live in <workdir>/.mcp.json (standard format).
 * Bridge calls mergeExtensionsForSession() before spawning an agent.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadUserConfig, saveUserConfig } from '../../core/config/user-config.js';
import type { McpServerConfig } from '../../core/config/user-config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExtensionScope = 'global' | 'workspace' | 'builtin';

export interface McpExtensionEntry {
  name: string;
  config: McpServerConfig;
  scope: ExtensionScope;
  /** Source file path (setting.json or .mcp.json). */
  source?: string;
}

export interface McpHealthResult {
  ok: boolean;
  tools?: string[];
  error?: string;
  elapsedMs?: number;
}

interface RegisteredMcpServer {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Global extensions (setting.json)
// ---------------------------------------------------------------------------

export function loadGlobalMcpExtensions(): McpExtensionEntry[] {
  const config = loadUserConfig();
  const mcp = config.extensions?.mcp;
  if (!mcp || typeof mcp !== 'object') return [];
  return Object.entries(mcp).map(([name, cfg]) => ({
    name,
    config: cfg,
    scope: 'global' as const,
  }));
}

export function addGlobalMcpExtension(name: string, config: McpServerConfig): void {
  const userConfig = loadUserConfig();
  const extensions = userConfig.extensions ?? {};
  const mcp = { ...(extensions.mcp ?? {}) };
  mcp[name] = config;
  saveUserConfig({ ...userConfig, extensions: { ...extensions, mcp } });
}

export function removeGlobalMcpExtension(name: string): boolean {
  const userConfig = loadUserConfig();
  const mcp = { ...(userConfig.extensions?.mcp ?? {}) };
  if (!(name in mcp)) return false;
  delete mcp[name];
  saveUserConfig({
    ...userConfig,
    extensions: { ...userConfig.extensions, mcp },
  });
  return true;
}

export function updateGlobalMcpExtension(name: string, patch: Partial<McpServerConfig>): boolean {
  const userConfig = loadUserConfig();
  const mcp = { ...(userConfig.extensions?.mcp ?? {}) };
  if (!(name in mcp)) return false;
  mcp[name] = { ...mcp[name], ...patch };
  saveUserConfig({
    ...userConfig,
    extensions: { ...userConfig.extensions, mcp },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Workspace extensions (.mcp.json)
// ---------------------------------------------------------------------------

function workspaceMcpJsonPath(workdir: string): string {
  return path.join(workdir, '.mcp.json');
}

function readMcpJson(filePath: string): Record<string, McpServerConfig> {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const servers = parsed?.mcpServers ?? parsed;
    if (typeof servers === 'object' && servers !== null && !Array.isArray(servers)) {
      return servers as Record<string, McpServerConfig>;
    }
  } catch { /* not found or invalid */ }
  return {};
}

function writeMcpJson(filePath: string, servers: Record<string, McpServerConfig>): void {
  const content = JSON.stringify({ mcpServers: servers }, null, 2) + '\n';
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

export function loadWorkspaceMcpExtensions(workdir: string): McpExtensionEntry[] {
  const mcpPath = workspaceMcpJsonPath(workdir);
  const servers = readMcpJson(mcpPath);
  return Object.entries(servers).map(([name, cfg]) => ({
    name,
    config: cfg,
    scope: 'workspace' as const,
    source: mcpPath,
  }));
}

export function addWorkspaceMcpExtension(workdir: string, name: string, config: McpServerConfig): void {
  const mcpPath = workspaceMcpJsonPath(workdir);
  const servers = readMcpJson(mcpPath);
  servers[name] = config;
  writeMcpJson(mcpPath, servers);
}

export function removeWorkspaceMcpExtension(workdir: string, name: string): boolean {
  const mcpPath = workspaceMcpJsonPath(workdir);
  const servers = readMcpJson(mcpPath);
  if (!(name in servers)) return false;
  delete servers[name];
  writeMcpJson(mcpPath, servers);
  return true;
}

export function updateWorkspaceMcpExtension(workdir: string, name: string, patch: Partial<McpServerConfig>): boolean {
  const mcpPath = workspaceMcpJsonPath(workdir);
  const servers = readMcpJson(mcpPath);
  if (!(name in servers)) return false;
  servers[name] = { ...servers[name], ...patch };
  writeMcpJson(mcpPath, servers);
  return true;
}

// ---------------------------------------------------------------------------
// Unified listing
// ---------------------------------------------------------------------------

export function listAllMcpExtensions(workdir?: string): McpExtensionEntry[] {
  const global = loadGlobalMcpExtensions();
  const workspace = workdir ? loadWorkspaceMcpExtensions(workdir) : [];
  // Also discover .claude/.mcp.json for Claude-specific servers
  const claudeMcp: McpExtensionEntry[] = [];
  if (workdir) {
    const claudePath = path.join(workdir, '.claude', '.mcp.json');
    const servers = readMcpJson(claudePath);
    for (const [name, cfg] of Object.entries(servers)) {
      claudeMcp.push({ name, config: cfg, scope: 'workspace', source: claudePath });
    }
  }
  return [...global, ...workspace, ...claudeMcp];
}

// ---------------------------------------------------------------------------
// Merge for session — called by bridge.ts
// ---------------------------------------------------------------------------

/**
 * Build the merged MCP server list for a session.
 * Priority (low → high): global → workspace .mcp.json → .claude/.mcp.json → ~/.claude/.mcp.json → builtins.
 * Disabled servers are filtered out.
 */
export function mergeExtensionsForSession(
  builtinServers: RegisteredMcpServer[],
  workdir?: string,
): Record<string, any> {
  const merged: Record<string, any> = {};

  // 1. Global extensions from setting.json (lowest priority)
  const userConfig = loadUserConfig();
  const globalMcp = userConfig.extensions?.mcp;
  if (globalMcp) {
    for (const [name, cfg] of Object.entries(globalMcp)) {
      if (cfg.enabled === false || cfg.disabled) continue;
      if (cfg.type === 'http' && cfg.url) {
        merged[name] = { type: 'http', url: cfg.url, ...(cfg.headers ? { headers: cfg.headers } : {}) };
      } else if (cfg.command) {
        merged[name] = {
          type: 'stdio',
          command: cfg.command,
          args: cfg.args || [],
          ...(cfg.env ? { env: cfg.env } : {}),
        };
      }
    }
  }

  // 2. Workspace .mcp.json files (overwrite global)
  if (workdir) {
    for (const candidate of [
      path.join(workdir, '.mcp.json'),
      path.join(workdir, '.claude', '.mcp.json'),
      path.join(os.homedir(), '.claude', '.mcp.json'),
    ]) {
      try {
        const raw = fs.readFileSync(candidate, 'utf-8');
        const parsed = JSON.parse(raw);
        const servers = parsed?.mcpServers ?? parsed;
        if (servers && typeof servers === 'object') {
          for (const [name, cfg] of Object.entries(servers) as [string, any][]) {
            if (cfg?.disabled === true) {
              // Workspace can disable a global extension
              delete merged[name];
            } else {
              Object.assign(merged, { [name]: cfg });
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  // 3. Built-in servers (highest priority)
  for (const server of builtinServers) {
    merged[server.name] = {
      type: 'stdio',
      command: server.command,
      args: server.args,
      ...(server.env ? { env: server.env } : {}),
    };
  }

  // Filter out any remaining disabled entries
  for (const [name, cfg] of Object.entries(merged)) {
    if (cfg?.disabled === true || cfg?.enabled === false) {
      delete merged[name];
    }
  }

  return merged;
}

/**
 * Convert global extensions to RegisteredMcpServer[] for Codex/Gemini agents
 * that use server arrays instead of merged configs.
 */
export function getGlobalExtensionsAsServers(workdir?: string): RegisteredMcpServer[] {
  const merged: Map<string, RegisteredMcpServer> = new Map();

  // Global extensions
  const userConfig = loadUserConfig();
  const globalMcp = userConfig.extensions?.mcp;
  if (globalMcp) {
    for (const [name, cfg] of Object.entries(globalMcp)) {
      if (cfg.enabled === false || cfg.disabled) continue;
      if (cfg.command) {
        merged.set(name, { name, command: cfg.command, args: cfg.args || [], env: cfg.env });
      }
    }
  }

  // Workspace overrides
  if (workdir) {
    const wsServers = readMcpJson(workspaceMcpJsonPath(workdir));
    for (const [name, cfg] of Object.entries(wsServers)) {
      if (cfg.disabled) {
        merged.delete(name);
      } else if (cfg.command) {
        merged.set(name, { name, command: cfg.command, args: cfg.args || [], env: cfg.env });
      }
    }
  }

  return [...merged.values()];
}

// ---------------------------------------------------------------------------
// Health check — spawn + MCP initialize handshake
// ---------------------------------------------------------------------------

export async function checkMcpHealth(config: McpServerConfig, timeoutMs = 10_000): Promise<McpHealthResult> {
  if (config.type === 'http') {
    // For HTTP servers, do a simple fetch to check availability
    try {
      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(config.url!, { signal: controller.signal, method: 'GET' });
      clearTimeout(timer);
      return { ok: res.ok || res.status === 405, elapsedMs: Date.now() - start };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'unreachable' };
    }
  }

  // Stdio: spawn the server and attempt MCP initialize handshake
  if (!config.command) return { ok: false, error: 'no command specified' };

  return new Promise((resolve) => {
    const start = Date.now();
    let checkInterval: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
      clearTimeout(timer);
    };

    const child = spawn(config.command!, config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
    });

    const timer = setTimeout(() => {
      cleanup();
      child.kill();
      resolve({ ok: false, error: `timeout after ${timeoutMs}ms`, elapsedMs: Date.now() - start });
    }, timeoutMs);

    let stdout = '';
    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });

    child.on('error', (err) => {
      cleanup();
      resolve({ ok: false, error: err.message, elapsedMs: Date.now() - start });
    });

    // Send MCP initialize request
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'pikiclaw-health-check', version: '1.0.0' },
      },
    });
    const header = `Content-Length: ${Buffer.byteLength(initRequest)}\r\n\r\n`;

    try {
      child.stdin?.write(header + initRequest);
    } catch {
      cleanup();
      resolve({ ok: false, error: 'failed to write to stdin', elapsedMs: Date.now() - start });
      return;
    }

    // Wait for response — check periodically
    checkInterval = setInterval(() => {
      // Look for Content-Length framed response or NDJSON
      const hasResponse = stdout.includes('"result"') || stdout.includes('"serverInfo"');
      if (!hasResponse) return;

      cleanup();

      // Now request tools list
      const toolsRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });
      const toolsHeader = `Content-Length: ${Buffer.byteLength(toolsRequest)}\r\n\r\n`;

      try { child.stdin?.write(toolsHeader + toolsRequest); } catch { /* best-effort */ }

      setTimeout(() => {
        child.kill();
        // Parse tools from response
        const tools: string[] = [];
        try {
          // Extract JSON from Content-Length framed response
          const jsonMatches = stdout.match(/\{[^{}]*"tools"\s*:\s*\[[\s\S]*?\]\s*[^{}]*\}/g);
          if (jsonMatches) {
            for (const m of jsonMatches) {
              try {
                const parsed = JSON.parse(m);
                if (Array.isArray(parsed.tools)) {
                  for (const tool of parsed.tools) {
                    if (tool.name) tools.push(tool.name);
                  }
                }
                if (parsed.result?.tools) {
                  for (const tool of parsed.result.tools) {
                    if (tool.name) tools.push(tool.name);
                  }
                }
              } catch { /* try next match */ }
            }
          }
        } catch { /* best effort */ }

        resolve({ ok: true, tools: tools.length ? tools : undefined, elapsedMs: Date.now() - start });
      }, 1500);
    }, 100);
  });
}
