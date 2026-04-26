/**
 * Playwright MCP proxy for browser automation integration.
 *
 * Spawned per agent stream as a stdio MCP server. Does NOT independently launch
 * Chrome — that responsibility moved to the in-process browser supervisor
 * (`src/browser-supervisor.ts`). Instead, at startup the proxy asks the
 * supervisor for a CDP endpoint via the bridge's HTTP callback server. The
 * supervisor's process-level cache means only the first stream of a pikiclaw
 * process triggers a Chrome launch; subsequent streams attach to the
 * already-running managed Chrome. If the supervisor cannot produce an endpoint
 * (browser disabled, supervisor URL unset, or Chrome failed to start) the
 * proxy falls back to the upstream's own `--user-data-dir` launch path.
 *
 * Net effect: enabling browser automation no longer opens a new Chrome window
 * for every agent run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRetainedLogSink, writeScopedLog, type LogLevel } from '../../core/logging.js';
import {
  getManagedBrowserProfileDir,
  resolveManagedBrowserMcpCommand,
} from '../../browser-profile.js';

const DISABLED_TOOLS = new Set(['browser_install']);
const DISABLED_TOOL_ERROR = [
  'browser_install is disabled by pikiclaw.',
  'Install Chrome locally and configure the browser mode during pikiclaw setup instead.',
].join(' ');

function envBool(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

const logSink = (() => {
  try {
    const profileDir = process.env.PIKICLAW_PLAYWRIGHT_PROFILE_DIR || getManagedBrowserProfileDir();
    fs.mkdirSync(profileDir, { recursive: true });
    return createRetainedLogSink(path.join(profileDir, 'playwright-mcp-proxy.log'));
  } catch {
    return null;
  }
})();

function log(message: string, level: LogLevel = 'debug') {
  if (!writeScopedLog('playwright-mcp-proxy', message, { level, stream: 'stderr' })) return;
  logSink?.(`[playwright-mcp-proxy ${new Date().toTimeString().slice(0, 8)}] ${message}\n`);
}

type Transport = 'framed' | 'ndjson';

function createSender(write: (chunk: string) => void) {
  return (transport: Transport, message: unknown) => {
    const body = JSON.stringify(message);
    if (transport === 'ndjson') write(`${body}\n`);
    else write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
}

function createParser(onMessage: (message: any) => void) {
  let transport: Transport | null = null;
  let buffer = '';

  const processFramed = () => {
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number.parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) break;
      const body = buffer.slice(bodyStart, bodyStart + length);
      buffer = buffer.slice(bodyStart + length);
      try { onMessage(JSON.parse(body)); } catch {}
    }
  };

  const processNdjson = () => {
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try { onMessage(JSON.parse(line)); } catch {}
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      if (!transport) {
        const trimmed = buffer.trimStart();
        if (!trimmed) return;
        transport = trimmed.startsWith('{') ? 'ndjson' : 'framed';
      }
      if (transport === 'ndjson') processNdjson();
      else processFramed();
    },
    transport(): Transport | null {
      return transport;
    },
  };
}

const profileDir = String(process.env.PIKICLAW_PLAYWRIGHT_PROFILE_DIR || '').trim() || getManagedBrowserProfileDir();
const headless = envBool('PIKICLAW_PLAYWRIGHT_HEADLESS', false);
// Endpoint base for the in-process browser supervisor exposed by the MCP bridge.
// Looks like `http://127.0.0.1:<port>/managed-browser`.
const supervisorUrl = String(process.env.PIKICLAW_BROWSER_SUPERVISOR_URL || '').trim() || null;
// Legacy explicit override — preserved for tests / standalone usage.
const explicitCdpEndpoint = String(process.env.PIKICLAW_PLAYWRIGHT_CDP_ENDPOINT || '').trim() || null;

const sendToParent = createSender(chunk => process.stdout.write(chunk));
let sendToChild: ((transport: Transport, message: unknown) => void) | null = null;
const pendingMethods = new Map<string, string>();
let parentTransport: Transport | null = null;
let childTransport: Transport | null = null;

let child: ChildProcess | null = null;
let upstreamReady: Promise<void> | null = null;
const queuedToChild: any[] = [];
let lastResolvedCdpEndpoint: string | null = null;

interface SupervisorSnapshot {
  cdpEndpoint: string | null;
  connectionMode?: 'attach' | 'launch' | 'unavailable';
}

async function callSupervisor(action: 'probe' | 'ensure' | 'invalidate', body?: unknown): Promise<SupervisorSnapshot | null> {
  if (!supervisorUrl) return null;
  const url = `${supervisorUrl}/${action}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) {
      log(`supervisor ${action} returned status=${response.status}`, 'warn');
      return null;
    }
    const data = await response.json().catch(() => null) as { ok?: boolean; cdpEndpoint?: string | null; connectionMode?: any } | null;
    if (!data || data.ok === false) {
      log(`supervisor ${action} reported failure`, 'warn');
      return null;
    }
    return { cdpEndpoint: data.cdpEndpoint ?? null, connectionMode: data.connectionMode };
  } catch (err: any) {
    log(`supervisor ${action} failed: ${err?.message || err}`, 'warn');
    return null;
  }
}

function spawnUpstream(cdpEndpoint: string | null): Promise<void> {
  if (child) return Promise.resolve();
  lastResolvedCdpEndpoint = cdpEndpoint;
  const upstreamMode = cdpEndpoint ? 'attach' : (headless ? 'headless' : 'headed');
  const upstream = resolveManagedBrowserMcpCommand(profileDir, { headless, cdpEndpoint });
  log(`spawn upstream source=${upstream.source} mode=${upstreamMode} command=${upstream.command} args=${JSON.stringify(upstream.args)}`);

  child = spawn(upstream.command, upstream.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PIKICLAW_PLAYWRIGHT_PROFILE_DIR: profileDir,
      PIKICLAW_PLAYWRIGHT_HEADLESS: String(headless),
      PIKICLAW_PLAYWRIGHT_CDP_ENDPOINT: cdpEndpoint || '',
    },
  });

  sendToChild = createSender(chunk => child!.stdin!.write(chunk));

  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', chunk => childParser.push(String(chunk)));
  child.stderr!.on('data', chunk => {
    const text = String(chunk).trim();
    if (text) log(`upstream stderr: ${text}`, 'warn');
  });
  child.on('close', code => {
    const graceful = code === 0 || code == null;
    log(`upstream exited code=${code ?? 'null'}`, graceful ? 'debug' : 'warn');
    // Invalidate the supervisor cache only when upstream dies abnormally — a
    // graceful shutdown at stream end leaves the managed Chrome (and its CDP
    // endpoint) intact, so we want subsequent streams to keep attaching.
    if (!graceful && lastResolvedCdpEndpoint) {
      void callSupervisor('invalidate');
    }
    process.exit(code ?? 0);
  });
  child.on('error', error => {
    log(`upstream spawn error: ${error.message}`, 'error');
    process.exit(1);
  });

  // Flush any messages buffered while we waited to spawn.
  if (queuedToChild.length && parentTransport && sendToChild) {
    for (const message of queuedToChild) sendToChild(parentTransport, message);
    queuedToChild.length = 0;
  }

  return Promise.resolve();
}

/**
 * Ensure the upstream `@playwright/mcp` server is spawned exactly once.
 * Resolves the CDP endpoint via the supervisor first (which itself probes for a
 * cached/already-running Chrome before launching one) and spawns the upstream
 * in attach mode when an endpoint is available, falling back to the upstream's
 * own `--user-data-dir` launch path otherwise.
 */
function ensureUpstream(): Promise<void> {
  if (child) return Promise.resolve();
  if (upstreamReady) return upstreamReady;

  upstreamReady = (async () => {
    let cdpEndpoint: string | null = explicitCdpEndpoint;
    if (!cdpEndpoint && supervisorUrl) {
      const ensured = await callSupervisor('ensure', { headless });
      cdpEndpoint = ensured?.cdpEndpoint || null;
    }
    await spawnUpstream(cdpEndpoint);
  })();

  // If the spawn fails, clear the gate so a later request can retry.
  upstreamReady.catch(() => {
    upstreamReady = null;
  });

  return upstreamReady;
}

const childParser = createParser(message => {
  childTransport = childParser.transport();
  parentTransport = parentTransport || childTransport;
  if (!parentTransport) return;

  const requestId = message?.id != null ? String(message.id) : '';
  const pendingMethod = requestId ? pendingMethods.get(requestId) || '' : '';

  if (pendingMethod === 'tools/list' && Array.isArray(message?.result?.tools)) {
    const original = message.result.tools;
    const filtered = original.filter((tool: any) => !DISABLED_TOOLS.has(String(tool?.name || '')));
    if (filtered.length !== original.length) {
      log(`filtered tools/list ${original.length} -> ${filtered.length}`);
      message = {
        ...message,
        result: {
          ...message.result,
          tools: filtered,
        },
      };
    }
  }

  if (requestId) pendingMethods.delete(requestId);
  sendToParent(parentTransport, message);
});

const parentParser = createParser(message => {
  parentTransport = parentParser.transport();
  if (!parentTransport) return;

  const requestId = message?.id;
  const method = typeof message?.method === 'string' ? message.method : '';
  const toolName = typeof message?.params?.name === 'string' ? message.params.name : '';
  if (requestId != null && method) pendingMethods.set(String(requestId), method);

  if (method === 'tools/call' && DISABLED_TOOLS.has(toolName)) {
    log(`blocked disabled tool call name=${toolName}`, 'warn');
    sendToParent(parentTransport, {
      jsonrpc: '2.0',
      id: requestId,
      result: {
        content: [{ type: 'text', text: DISABLED_TOOL_ERROR }],
        isError: true,
      },
    });
    pendingMethods.delete(String(requestId));
    return;
  }

  if (child && sendToChild) {
    sendToChild(parentTransport, message);
    return;
  }

  // Upstream not yet spawned — buffer this message; ensureUpstream() is already
  // in flight (kicked off at module load) and will flush the queue once ready.
  queuedToChild.push(message);
  void ensureUpstream();
});

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => parentParser.push(String(chunk)));
process.stdin.on('end', () => {
  if (child?.stdin) child.stdin.end();
});

// Kick off the upstream spawn pre-emptively so the first MCP request from the
// agent (typically `initialize`) does not pay full cold-start latency.
void ensureUpstream();
