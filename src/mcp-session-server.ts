/**
 * mcp-session-server.ts — MCP server process for pikiclaw session bridge.
 *
 * Spawned by the agent CLI (claude/codex/gemini) via --mcp-config or codex mcp add.
 * Communicates with the agent over stdio using the MCP protocol (JSON-RPC 2.0).
 *
 * Supports two stdio transports (auto-detected from first byte):
 *   - Content-Length framing (Claude, Gemini — standard MCP/LSP)
 *   - Newline-delimited JSON (Codex)
 *
 * Context is injected via environment variables:
 *   MCP_WORKSPACE_PATH — absolute path to the session workspace
 *   MCP_STAGED_FILES   — JSON array of staged file relative paths
 *   MCP_CALLBACK_URL   — HTTP URL for the pikiclaw callback server
 *
 * Tools:
 *   pikiclaw_get_session_info    — returns workspace path and staged files
 *   pikiclaw_list_workspace_files — lists files in the workspace directory
 *   pikiclaw_send_file           — sends a workspace file back to the IM chat
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// Context from environment
// ---------------------------------------------------------------------------

const WORKSPACE = process.env.MCP_WORKSPACE_PATH || '';
const STAGED_FILES: string[] = (() => {
  try { return JSON.parse(process.env.MCP_STAGED_FILES || '[]'); } catch { return []; }
})();
const CALLBACK_URL = process.env.MCP_CALLBACK_URL || '';

// ---------------------------------------------------------------------------
// MCP protocol — auto-detect transport format
// ---------------------------------------------------------------------------

/** 'framed' = Content-Length (Claude/Gemini), 'ndjson' = newline-delimited (Codex) */
let transport: 'framed' | 'ndjson' | null = null;

function send(msg: object) {
  const body = JSON.stringify(msg);
  if (transport === 'ndjson') {
    process.stdout.write(body + '\n');
  } else {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }
}

function respond(id: unknown, result: object) {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id: unknown, code: number, message: string) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function toolResult(text: string, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

// ---------------------------------------------------------------------------
// Stdio reader — auto-detecting Content-Length framed vs NDJSON
// ---------------------------------------------------------------------------

let buffer = '';

/** Process buffer in Content-Length framed mode. */
function processFramed() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
    const len = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + len) break;
    const body = buffer.slice(bodyStart, bodyStart + len);
    buffer = buffer.slice(bodyStart + len);
    try { handleMessage(JSON.parse(body)); } catch { /* ignore parse errors */ }
  }
}

/** Process buffer in newline-delimited JSON mode. */
function processNdjson() {
  while (true) {
    const newlineIdx = buffer.indexOf('\n');
    if (newlineIdx < 0) break;
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (!line) continue;
    try { handleMessage(JSON.parse(line)); } catch { /* ignore parse errors */ }
  }
}

function processBuffer() {
  // Auto-detect transport from the first non-whitespace byte
  if (transport === null) {
    const trimmed = buffer.trimStart();
    if (!trimmed) return;
    transport = trimmed[0] === '{' ? 'ndjson' : 'framed';
  }
  if (transport === 'ndjson') processNdjson();
  else processFramed();
}

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  processBuffer();
});
process.stdin.on('end', () => process.exit(0));

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'pikiclaw_get_session_info',
    description: 'Get the current pikiclaw session workspace path and list of user-uploaded files.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'pikiclaw_list_workspace_files',
    description: 'List files and directories in the pikiclaw session workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        subdirectory: {
          type: 'string',
          description: 'Subdirectory relative to workspace root. Omit to list root.',
        },
      },
    },
  },
  {
    name: 'pikiclaw_send_file',
    description: [
      'Send a file back to the user via their IM chat.',
      'IMPORTANT: You MUST call this tool to send any file (image, document, etc.) to the user. Do NOT just print the file path — the user cannot access local files.',
      'Accepts absolute paths or paths relative to the session workspace.',
      'Allowed locations: session workspace, agent workdir, and /tmp.',
      'For images (png/jpg/jpeg/webp), set kind to "photo" for inline display.',
    ].join(' '),
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path (absolute, or relative to session workspace).',
        },
        caption: {
          type: 'string',
          description: 'Optional caption or description for the file.',
        },
        kind: {
          type: 'string',
          enum: ['photo', 'document'],
          description: 'File display type. Auto-detected from extension if omitted.',
        },
      },
      required: ['path'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

function handleGetSessionInfo(id: unknown) {
  respond(id, toolResult(JSON.stringify({
    workspacePath: WORKSPACE,
    stagedFiles: STAGED_FILES,
  }, null, 2)));
}

function handleListWorkspaceFiles(id: unknown, args: Record<string, unknown>) {
  const subdir = typeof args?.subdirectory === 'string' ? args.subdirectory : '';
  const dir = subdir ? path.resolve(WORKSPACE, subdir) : WORKSPACE;

  // Security: ensure we stay within workspace
  const realWorkspace = safeRealpath(WORKSPACE);
  const realDir = safeRealpath(dir);
  if (!realWorkspace || !realDir || !realDir.startsWith(realWorkspace)) {
    respond(id, toolResult('Error: path is outside the workspace', true));
    return;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries.map(e => {
      const entry: Record<string, unknown> = { name: e.name, type: e.isDirectory() ? 'directory' : 'file' };
      if (e.isFile()) {
        try { entry.size = fs.statSync(path.join(dir, e.name)).size; } catch {}
      }
      return entry;
    });
    respond(id, toolResult(JSON.stringify(files, null, 2)));
  } catch (e: any) {
    respond(id, toolResult(`Error listing directory: ${e.message}`, true));
  }
}

async function handleSendFile(id: unknown, args: Record<string, unknown>) {
  const filePath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!filePath) {
    respond(id, toolResult('Error: "path" is required', true));
    return;
  }
  if (!CALLBACK_URL) {
    respond(id, toolResult('Error: MCP callback URL is not configured', true));
    return;
  }

  try {
    const result = await callbackSendFile(filePath, {
      caption: typeof args?.caption === 'string' ? args.caption : undefined,
      kind: typeof args?.kind === 'string' ? args.kind : undefined,
    });
    if (result.ok) {
      respond(id, toolResult(`File sent successfully: ${filePath}`));
    } else {
      respond(id, toolResult(`Failed to send file: ${result.error || 'unknown error'}`, true));
    }
  } catch (e: any) {
    respond(id, toolResult(`Error sending file: ${e.message}`, true));
  }
}

// ---------------------------------------------------------------------------
// HTTP callback to pikiclaw main process
// ---------------------------------------------------------------------------

function callbackSendFile(
  filePath: string,
  opts: { caption?: string; kind?: string },
): Promise<{ ok: boolean; error?: string }> {
  const body = JSON.stringify({ path: filePath, ...opts });
  const url = new URL('/send-file', CALLBACK_URL);

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ ok: false, error: 'invalid callback response' }); }
      });
    });
    req.on('error', e => reject(e));
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeRealpath(p: string): string | null {
  try { return fs.realpathSync(p); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Message dispatcher
// ---------------------------------------------------------------------------

function handleMessage(msg: any) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'pikiclaw-session', version: '1.0.0' },
      });
      break;

    case 'notifications/initialized':
      // Notification — no response needed
      break;

    case 'tools/list':
      respond(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments || {};
      switch (name) {
        case 'pikiclaw_get_session_info':
          handleGetSessionInfo(id);
          break;
        case 'pikiclaw_list_workspace_files':
          handleListWorkspaceFiles(id, args);
          break;
        case 'pikiclaw_send_file':
          void handleSendFile(id, args);
          break;
        default:
          respondError(id, -32601, `Unknown tool: ${name}`);
      }
      break;
    }

    default:
      if (id !== undefined) {
        respondError(id, -32601, `Method not found: ${method}`);
      }
  }
}
