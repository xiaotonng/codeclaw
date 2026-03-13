/**
 * mcp-bridge.ts — MCP session bridge orchestrator.
 *
 * Runs inside the main pikiclaw process. For each agent stream:
 *   1. Starts a tiny HTTP callback server on localhost (random port).
 *   2. Writes an MCP config JSON pointing to `pikiclaw --mcp-serve`.
 *   3. The agent CLI spawns the MCP server via --mcp-config.
 *   4. When the agent calls `send_file`, the MCP server POSTs to our callback.
 *   5. We forward the request to the IM channel and respond with success/failure.
 *
 * Lifecycle: one bridge per stream, created before spawn, stopped after stream ends.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpSendFileOpts {
  caption?: string;
  kind?: 'photo' | 'document';
}

export interface McpSendFileResult {
  ok: boolean;
  error?: string;
}

export type McpSendFileCallback = (
  filePath: string,
  opts: McpSendFileOpts,
) => Promise<McpSendFileResult>;

export interface McpBridgeHandle {
  /** Path to the generated MCP config JSON — pass to agent CLI via --mcp-config. */
  configPath: string;
  /** Gracefully stop the callback server and clean up config file. */
  stop: () => Promise<void>;
}

export interface McpBridgeOpts {
  /** Absolute path to session directory (parent of workspace). */
  sessionDir: string;
  /** Absolute path to the session workspace. */
  workspacePath: string;
  /** Agent workdir (cwd passed to agent). Files here are also allowed for send. */
  workdir?: string;
  /** List of staged file paths (relative to workspace). */
  stagedFiles: string[];
  /** Callback invoked when the agent calls the send_file MCP tool. */
  sendFile: McpSendFileCallback;
  /** Agent type — determines how MCP server is registered. */
  agent?: string;
}

// ---------------------------------------------------------------------------
// Resolve the MCP server entry script path
// ---------------------------------------------------------------------------

/**
 * Find the compiled mcp-session-server.js next to this file's compiled output.
 * Falls back to running via the CLI entry point with --mcp-serve.
 */
interface McpServerRuntimeInfo {
  execPath: string;
  execArgv: string[];
  argv: string[];
  moduleUrl: string;
}

function sanitizeExecArgv(execArgv: string[]): string[] {
  return execArgv.filter(arg => !/^--inspect(?:-brk)?(?:=.*)?$/.test(arg));
}

function resolveCurrentProcessCommand(runtime: McpServerRuntimeInfo): { command: string; args: string[] } | null {
  const entryScript = runtime.argv[1] ? path.resolve(runtime.argv[1]) : '';
  const base = path.basename(entryScript).toLowerCase();
  if (!entryScript || !fs.existsSync(entryScript)) return null;
  if (base !== 'cli.js' && base !== 'cli.ts') return null;
  return {
    command: runtime.execPath,
    args: [...sanitizeExecArgv(runtime.execArgv), entryScript, '--mcp-serve'],
  };
}

export function resolveMcpServerCommand(runtime: McpServerRuntimeInfo = {
  execPath: process.execPath,
  execArgv: process.execArgv,
  argv: process.argv,
  moduleUrl: import.meta.url,
}): { command: string; args: string[] } {
  const currentProcess = resolveCurrentProcessCommand(runtime);
  if (currentProcess) return currentProcess;

  // Try to find the compiled JS file in the same directory as this module
  const thisDir = path.dirname(fileURLToPath(runtime.moduleUrl));
  const serverScript = path.join(thisDir, 'mcp-session-server.js');
  if (fs.existsSync(serverScript)) {
    return { command: 'node', args: [serverScript] };
  }
  // Fallback: use pikiclaw CLI with --mcp-serve flag
  const cliScript = path.join(thisDir, 'cli.js');
  if (fs.existsSync(cliScript)) {
    return { command: 'node', args: [cliScript, '--mcp-serve'] };
  }
  // Last resort: assume pikiclaw is in PATH
  return { command: 'pikiclaw', args: ['--mcp-serve'] };
}

// ---------------------------------------------------------------------------
// Bridge implementation
// ---------------------------------------------------------------------------

const ARTIFACT_MAX_BYTES = 20 * 1024 * 1024;
const SEND_FILE_TIMEOUT_MS = 60_000; // 60s timeout for sendFile callback
const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function isPhotoFile(filePath: string): boolean {
  return PHOTO_EXTS.has(path.extname(filePath).toLowerCase());
}

/** Check if realFile is inside any of the allowed root directories. */
function isInsideAllowedRoot(realFile: string, allowedRoots: string[]): boolean {
  for (const root of allowedRoots) {
    try {
      const realRoot = fs.realpathSync(root);
      const rel = path.relative(realRoot, realFile);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true;
    } catch { /* root doesn't exist, skip */ }
  }
  return false;
}

export function resolveSendFilePath(
  inputPath: string,
  workspacePath: string,
  workdir?: string,
): string | null {
  const requested = String(inputPath || '').trim();
  if (!requested) return null;
  if (path.isAbsolute(requested)) return requested;

  const candidates = [
    path.resolve(workspacePath, requested),
    ...(workdir ? [path.resolve(workdir, requested)] : []),
  ];

  for (const candidate of candidates) {
    try {
      fs.realpathSync(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return candidates[0] || null;
}

export async function startMcpBridge(opts: McpBridgeOpts): Promise<McpBridgeHandle> {
  const { sessionDir, workspacePath, stagedFiles, sendFile } = opts;

  // Build allowed roots: workspace + workdir + /tmp
  const allowedRoots = [workspacePath];
  if (opts.workdir) allowedRoots.push(opts.workdir);
  allowedRoots.push('/tmp', os.tmpdir());

  // ── HTTP callback server ──
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/send-file') {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });

    // Timeout for receiving the request body
    const bodyTimer = setTimeout(() => {
      req.destroy(new Error('request body timeout'));
    }, 10_000);

    req.on('end', async () => {
      clearTimeout(bodyTimer);
      try {
        const data = JSON.parse(body);
        const relPath = String(data.path || '').trim();
        if (!relPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'path is required' }));
          return;
        }

        // Resolve and validate path
        const absPath = resolveSendFilePath(relPath, workspacePath, opts.workdir);
        let realFile: string;
        try { realFile = fs.realpathSync(String(absPath || '')); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `file not found: ${relPath}` }));
          return;
        }
        if (!isInsideAllowedRoot(realFile, allowedRoots)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'file must be inside the workspace, workdir, or /tmp' }));
          return;
        }

        // Size check
        const stat = fs.statSync(realFile);
        if (!stat.isFile()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'not a regular file' }));
          return;
        }
        if (stat.size > ARTIFACT_MAX_BYTES) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `file too large (${stat.size} bytes, max ${ARTIFACT_MAX_BYTES})` }));
          return;
        }

        // Auto-detect kind
        const kind = data.kind === 'photo' ? 'photo'
          : data.kind === 'document' ? 'document'
          : isPhotoFile(realFile) ? 'photo'
          : 'document';

        const caption = typeof data.caption === 'string' ? data.caption.trim().slice(0, 1024) || undefined : undefined;

        const result = await Promise.race([
          sendFile(realFile, { caption, kind }),
          new Promise<McpSendFileResult>((_, reject) =>
            setTimeout(() => reject(new Error(`sendFile timed out after ${SEND_FILE_TIMEOUT_MS / 1000}s`)), SEND_FILE_TIMEOUT_MS),
          ),
        ]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e?.message || 'internal error' }));
      }
    });
  });

  // Set server-level timeouts to prevent hanging connections
  server.requestTimeout = 90_000;   // 90s max for entire request lifecycle
  server.headersTimeout = 10_000;   // 10s to receive headers

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as { port: number }).port;

  // ── Register MCP server with the agent ──
  const { command, args } = resolveMcpServerCommand();
  const envVars = {
    MCP_WORKSPACE_PATH: workspacePath,
    MCP_STAGED_FILES: JSON.stringify(stagedFiles),
    MCP_CALLBACK_URL: `http://127.0.0.1:${port}`,
  };

  let configPath = '';
  let codexRegistered = false;

  if (opts.agent === 'codex') {
    // Codex: register MCP server via `codex mcp add/remove`
    const codexArgs = ['mcp', 'add', 'pikiclaw'];
    for (const [k, v] of Object.entries(envVars)) codexArgs.push('--env', `${k}=${v}`);
    codexArgs.push('--', command, ...args);
    try {
      execFileSync('codex', codexArgs, { stdio: 'pipe', timeout: 10_000 });
      codexRegistered = true;
    } catch (e: any) {
      // If already exists, remove and retry
      try { execFileSync('codex', ['mcp', 'remove', 'pikiclaw'], { stdio: 'pipe', timeout: 5_000 }); } catch {}
      execFileSync('codex', codexArgs, { stdio: 'pipe', timeout: 10_000 });
      codexRegistered = true;
    }
  } else {
    // Claude/Gemini: write MCP config JSON for --mcp-config
    configPath = path.join(sessionDir, 'mcp-config.json');
    const config = {
      mcpServers: {
        pikiclaw: { type: 'stdio', command, args, env: envVars },
      },
    };
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  return {
    configPath,
    stop: async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (codexRegistered) {
        try { execFileSync('codex', ['mcp', 'remove', 'pikiclaw'], { stdio: 'pipe', timeout: 5_000 }); } catch {}
      }
      if (configPath) {
        try { fs.rmSync(configPath, { force: true }); } catch {}
      }
    },
  };
}
