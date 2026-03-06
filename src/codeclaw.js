/**
 * codeclaw — zero config, bridge AI coding agents to any IM.
 *
 * Core orchestrator: config, state management, engine execution, CLI entry point.
 * Channel-specific interaction is in separate files (channel-telegram.js, etc.).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function envBool(name, defaultVal) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return defaultVal;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export function envInt(name, defaultVal) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === '') return defaultVal;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? defaultVal : n;
}

export function parseAllowedChatIds(raw) {
  const ids = new Set();
  for (const token of raw.split(',')) {
    const t = token.trim();
    if (!t) continue;
    const n = parseInt(t, 10);
    if (!Number.isNaN(n)) ids.add(n);
  }
  return ids;
}

export function normalizeReasoningEffort(raw) {
  const value = raw.trim().toLowerCase();
  const allowed = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  if (!allowed.has(value)) {
    throw new Error(
      'Invalid CODEX_REASONING_EFFORT. Use one of: none, minimal, low, medium, high, xhigh'
    );
  }
  return value;
}

export function normalizeSessionName(raw) {
  const name = raw.trim().toLowerCase();
  if (!name) return 'default';
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) {
    throw new Error(
      'Invalid session name. Use 1-32 chars: a-z, 0-9, _ or -, start with letter/number.'
    );
  }
  return name;
}

export const VALID_ENGINES = new Set(['codex', 'claude']);

export function normalizeEngine(raw) {
  const value = raw.trim().toLowerCase();
  if (!VALID_ENGINES.has(value)) {
    throw new Error(`Invalid engine. Use one of: ${[...VALID_ENGINES].sort().join(', ')}`);
  }
  return value;
}

function shellSplit(str) {
  const args = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (current) { args.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

function whichSync(cmd) {
  try {
    return execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf-8' }).trim() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export class CodeClaw {
  constructor() {
    const token = (process.env.TELEGRAM_BOT_TOKEN || process.env.CODECLAW_TOKEN || '').trim();
    if (!token) {
      throw new Error('Missing token. Use -t TOKEN or set CODECLAW_TOKEN / TELEGRAM_BOT_TOKEN');
    }
    this.token = token;

    const defaultWorkdir = process.cwd();
    this.workdir = path.resolve((process.env.CODECLAW_WORKDIR || defaultWorkdir).replace(/^~/, process.env.HOME || ''));
    this.stateDir = path.resolve((process.env.CODECLAW_STATE_DIR || '~/.codeclaw').replace(/^~/, process.env.HOME || ''));

    fs.mkdirSync(this.stateDir, { recursive: true });
    this.stateFile = path.join(this.stateDir, 'state.json');
    this.lockFile = path.join(this.stateDir, 'bridge.lock');

    this.pollTimeout = envInt('TELEGRAM_POLL_TIMEOUT', 45);
    this.runTimeout = envInt('CODECLAW_TIMEOUT', 300);
    this.requireMention = envBool('TELEGRAM_REQUIRE_MENTION_IN_GROUP', true);
    this.allowedChatIds = parseAllowedChatIds(
      process.env.TELEGRAM_ALLOWED_CHAT_IDS || process.env.CODECLAW_ALLOWED_IDS || ''
    );

    // Codex settings
    this.codexModel = (process.env.CODEX_MODEL || 'gpt-5.4').trim();
    this.codexReasoningEffort = normalizeReasoningEffort(
      process.env.CODEX_REASONING_EFFORT || 'xhigh'
    );
    this.codexFullAccess = envBool('CODEX_FULL_ACCESS', true);
    this.codexExtraArgs = shellSplit(process.env.CODEX_EXTRA_ARGS || '');

    // Claude settings
    this.claudeModel = (process.env.CLAUDE_MODEL || 'claude-opus-4-6').trim();
    this.claudePermissionMode = (process.env.CLAUDE_PERMISSION_MODE || 'bypassPermissions').trim();
    this.claudeExtraArgs = shellSplit(process.env.CLAUDE_EXTRA_ARGS || '');

    // Default engine
    this.defaultEngine = normalizeEngine(process.env.DEFAULT_ENGINE || 'claude');

    this.botUsername = '';
    this.botId = 0;
    this.running = true;
    this.lockFd = null;
    this._replacedOldProcess = false;

    this.state = { last_update_id: 0, chats: {} };
    this._resetState();
  }

  // -------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------

  _log(msg, { err = false } = {}) {
    const ts = new Date().toTimeString().slice(0, 8);
    const out = err ? process.stderr : process.stdout;
    out.write(`[codeclaw ${ts}] ${msg}\n`);
  }

  // -------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------

  _resetState() {
    if (!fs.existsSync(this.stateFile)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        this.state.last_update_id = parseInt(parsed.last_update_id, 10) || 0;
      }
    } catch { /* ignore */ }
    this.state.chats = {};
    this._saveState();
  }

  _ensureChatState(chatId) {
    const key = String(chatId);
    if (!this.state.chats[key]) {
      this.state.chats[key] = {
        active: 'default',
        threads: { default: '' },
        engine: this.defaultEngine,
      };
    }
    const cs = this.state.chats[key];
    let active = normalizeSessionName(String(cs.active || 'default'));
    cs.active = active;
    if (!cs.engine) cs.engine = this.defaultEngine;
    const raw = cs.threads && typeof cs.threads === 'object' ? cs.threads : {};
    const norm = {};
    for (const [name, tid] of Object.entries(raw)) {
      norm[normalizeSessionName(String(name))] = String(tid).trim();
    }
    if (!norm[active]) norm[active] = '';
    cs.threads = norm;
    return cs;
  }

  _saveState() {
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  // -------------------------------------------------------------------
  // Session helpers
  // -------------------------------------------------------------------

  _sessionForChat(chatId) {
    const cs = this._ensureChatState(chatId);
    const name = cs.active;
    const tid = (cs.threads[name] || '').trim() || null;
    return [name, tid];
  }

  _engineForChat(chatId) {
    return this._ensureChatState(chatId).engine || this.defaultEngine;
  }

  _setEngineForChat(chatId, engine) {
    this._ensureChatState(chatId).engine = normalizeEngine(engine);
    this._saveState();
  }

  _setActiveSession(chatId, sessionName) {
    const cs = this._ensureChatState(chatId);
    const name = normalizeSessionName(sessionName);
    cs.active = name;
    if (!cs.threads[name]) cs.threads[name] = '';
    this._saveState();
  }

  _setSessionThread(chatId, sessionName, threadId) {
    const cs = this._ensureChatState(chatId);
    cs.threads[normalizeSessionName(sessionName)] = (threadId || '').trim();
    this._saveState();
  }

  _deleteSession(chatId, sessionName) {
    const cs = this._ensureChatState(chatId);
    const name = normalizeSessionName(sessionName);
    delete cs.threads[name];
    if (Object.keys(cs.threads).length === 0) cs.threads.default = '';
    if (cs.active === name) {
      cs.active = 'default';
      if (!cs.threads.default) cs.threads.default = '';
    }
    this._saveState();
  }

  // -------------------------------------------------------------------
  // Process lock & lifecycle
  // -------------------------------------------------------------------

  _readPidFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      return content ? parseInt(content, 10) : null;
    } catch {
      return null;
    }
  }

  _killProcess(pid) {
    this._replacedOldProcess = true;
    this._log(`killing existing process (PID ${pid}) ...`);
    try {
      process.kill(pid, 'SIGTERM');
      const start = Date.now();
      while (Date.now() - start < 3000) {
        try { process.kill(pid, 0); } catch { break; }
        const wait = ms => { const end = Date.now() + ms; while (Date.now() < end) { /* busy wait */ } };
        wait(100);
      }
      try {
        process.kill(pid, 0);
        this._log(`force killing PID ${pid}`);
        process.kill(pid, 'SIGKILL');
      } catch { /* already dead */ }
    } catch { /* process doesn't exist */ }
    this._log(`old process (PID ${pid}) terminated`);
  }

  _acquireLock() {
    const oldPid = this._readPidFile(this.lockFile);
    try {
      this.lockFd = fs.openSync(this.lockFile, 'w');
    } catch (e) {
      throw new Error(`Failed to open lock file: ${this.lockFile}`);
    }

    // Try to write PID - if another process is running, kill it
    if (oldPid && oldPid !== process.pid) {
      try { process.kill(oldPid, 0); this._killProcess(oldPid); } catch { /* not running */ }
    }

    fs.writeSync(this.lockFd, String(process.pid));
  }

  _ensureSingleBot() {
    const pidFile = path.join(this.stateDir, `bot_${this.botId}.pid`);
    const oldPid = this._readPidFile(pidFile);
    if (oldPid && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 0);
        this._log(`same bot @${this.botUsername} running elsewhere (PID ${oldPid})`);
        this._killProcess(oldPid);
      } catch { /* not running */ }
    }
    fs.writeFileSync(pidFile, String(process.pid), 'utf-8');
  }

  _handleSignal(sig) {
    this.running = false;
    this._log(`signal ${sig}, shutting down...`);
    this._stopKeepAlive();
  }

  // -------------------------------------------------------------------
  // Keep-alive (prevent idle sleep)
  // -------------------------------------------------------------------

  _startKeepAlive() {
    this._keepAliveProc = null;
    const platform = process.platform;

    if (platform === 'darwin') {
      const caffeinate = whichSync('caffeinate');
      if (caffeinate) {
        this._keepAliveProc = spawn('caffeinate', ['-dis'], {
          stdio: 'ignore',
          detached: true,
        });
        this._keepAliveProc.unref();
        this._log(`keep-alive: caffeinate started (PID ${this._keepAliveProc.pid})`);
      } else {
        this._log('keep-alive: caffeinate not found, skipping', { err: true });
      }
    } else if (platform === 'linux') {
      const inhibit = whichSync('systemd-inhibit');
      if (inhibit) {
        this._keepAliveProc = spawn('systemd-inhibit', [
          '--what=idle', '--who=codeclaw',
          '--why=AI coding agent running', 'sleep', 'infinity',
        ], { stdio: 'ignore', detached: true });
        this._keepAliveProc.unref();
        this._log(`keep-alive: systemd-inhibit started (PID ${this._keepAliveProc.pid})`);
      } else {
        this._log('keep-alive: systemd-inhibit not found, skipping', { err: true });
      }
    } else {
      this._log(`keep-alive: unsupported platform (${platform}), skipping`);
    }
  }

  _stopKeepAlive() {
    if (this._keepAliveProc) {
      try { this._keepAliveProc.kill('SIGTERM'); } catch { /* ignore */ }
      this._keepAliveProc = null;
      this._log('keep-alive: stopped');
    }
  }

  // -------------------------------------------------------------------
  // Engine command builders
  // -------------------------------------------------------------------

  _buildCodexCmd(threadId) {
    const common = ['--json'];
    if (this.codexModel) common.push('-m', this.codexModel);
    common.push('-c', `model_reasoning_effort="${this.codexReasoningEffort}"`);
    if (this.codexFullAccess) common.push('--dangerously-bypass-approvals-and-sandbox');
    common.push(...this.codexExtraArgs);
    if (threadId) {
      return ['codex', 'exec', 'resume', ...common, threadId, '-'];
    }
    return ['codex', 'exec', ...common, '-'];
  }

  _buildClaudeCmd(threadId) {
    const cmd = ['claude', '-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages'];
    if (this.claudeModel) cmd.push('--model', this.claudeModel);
    if (this.claudePermissionMode) cmd.push('--permission-mode', this.claudePermissionMode);
    if (threadId) cmd.push('--resume', threadId);
    cmd.push(...this.claudeExtraArgs);
    return cmd;
  }

  // -------------------------------------------------------------------
  // Engine execution
  // -------------------------------------------------------------------

  spawnEngine(prompt, engine, threadId) {
    const cmd = engine === 'codex'
      ? this._buildCodexCmd(threadId)
      : this._buildClaudeCmd(threadId);
    const resume = threadId ? ` resume=${threadId.slice(0, 12)}` : ' new-thread';
    this._log(`spawn ${engine}${resume} prompt=${JSON.stringify(prompt.slice(0, 80))}`);
    this._log(`  cmd: ${cmd.join(' ').slice(0, 200)}`);

    const proc = spawn(cmd[0], cmd.slice(1), {
      cwd: this.workdir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (proc.stdin) {
      try {
        proc.stdin.write(prompt);
        proc.stdin.end();
      } catch { /* broken pipe */ }
    }

    return proc;
  }

  parseEvents(proc, engine, threadId, onText) {
    return new Promise((resolve) => {
      const start = Date.now();
      let collectedText = '';
      let discoveredThread = threadId;
      let usageInput = null;
      let usageCached = null;
      let usageOutput = null;
      const messagesBuffer = [];
      let stderr = '';
      const deadline = Date.now() + this.runTimeout * 1000;

      if (proc.stderr) {
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      }

      const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

      rl.on('line', (rawLine) => {
        if (Date.now() > deadline) {
          proc.kill('SIGKILL');
          return;
        }
        const line = rawLine.trim();
        if (!line || !line.startsWith('{')) return;

        let event;
        try { event = JSON.parse(line); } catch { return; }

        const evType = event.type || '';

        // --- Codex events ---
        if (evType === 'thread.started') {
          discoveredThread = event.thread_id || discoveredThread;
        }
        if (evType === 'item.completed') {
          const item = event.item || {};
          if (item.type === 'agent_message') {
            const text = (item.text || '').trim();
            if (text) {
              messagesBuffer.push(text);
              collectedText = messagesBuffer.join('\n\n');
              onText(collectedText);
            }
          }
        }
        if (evType === 'turn.completed') {
          const usage = event.usage;
          if (usage && typeof usage === 'object') {
            if (typeof usage.input_tokens === 'number') usageInput = usage.input_tokens;
            if (typeof usage.cached_input_tokens === 'number') usageCached = usage.cached_input_tokens;
            if (typeof usage.output_tokens === 'number') usageOutput = usage.output_tokens;
          }
        }

        // --- Claude Code events ---
        if (evType === 'system') {
          if (event.session_id) discoveredThread = event.session_id;
        }

        if (evType === 'stream_event') {
          const inner = event.event || {};
          const innerType = inner.type || '';
          if (innerType === 'content_block_delta') {
            const delta = inner.delta || {};
            if (delta.type === 'text_delta') {
              collectedText += delta.text || '';
              onText(collectedText);
            }
          } else if (innerType === 'message_delta') {
            const su = inner.usage;
            if (su && typeof su === 'object') {
              if (typeof su.input_tokens === 'number') usageInput = su.input_tokens;
              if (typeof su.cache_read_input_tokens === 'number') usageCached = su.cache_read_input_tokens;
              if (typeof su.output_tokens === 'number') usageOutput = su.output_tokens;
            }
          }
          if (event.session_id) discoveredThread = event.session_id;
        }

        if (evType === 'assistant') {
          const contents = (event.message || {}).content || [];
          const fullText = contents
            .filter(b => b && b.type === 'text')
            .map(b => b.text || '')
            .join('');
          if (fullText && !collectedText.trim()) {
            collectedText = fullText;
            onText(collectedText);
          }
        }

        if (evType === 'result') {
          if (event.session_id) discoveredThread = event.session_id;
          const resultText = event.result || '';
          if (resultText && !collectedText.trim()) collectedText = resultText;
          const usageData = event.usage;
          if (usageData && typeof usageData === 'object') {
            if (typeof usageData.input_tokens === 'number') usageInput = usageData.input_tokens;
            const ca = usageData.cache_read_input_tokens ?? usageData.cached_input_tokens;
            if (typeof ca === 'number') usageCached = ca;
            if (typeof usageData.output_tokens === 'number') usageOutput = usageData.output_tokens;
          }
        }
      });

      proc.on('close', (code) => {
        const elapsed = (Date.now() - start) / 1000;
        const ok = code === 0;

        if (!collectedText.trim() && messagesBuffer.length) {
          collectedText = messagesBuffer.join('\n\n');
        }

        let message;
        if (collectedText.trim()) {
          message = collectedText.trim();
        } else if (ok) {
          message = '(no textual response)';
        } else {
          message = `Failed (exit=${code}).\n\n${stderr.trim() || '(no output)'}`;
        }

        resolve({
          threadId: discoveredThread,
          message,
          ok,
          elapsedS: elapsed,
          inputTokens: usageInput,
          cachedInputTokens: usageCached,
          outputTokens: usageOutput,
        });
      });

      proc.on('error', (err) => {
        this._log(`stream error: ${err}`, { err: true });
        const elapsed = (Date.now() - start) / 1000;
        resolve({
          threadId: discoveredThread,
          message: `Failed: ${err.message}`,
          ok: false,
          elapsedS: elapsed,
          inputTokens: usageInput,
          cachedInputTokens: usageCached,
          outputTokens: usageOutput,
        });
      });
    });
  }

  // -------------------------------------------------------------------
  // Preflight & run
  // -------------------------------------------------------------------

  async preflight() {
    const url = `https://api.telegram.org/bot${this.token}/getMe`;
    this._log('preflight: validating bot token...');

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await resp.json();
    const me = data.result || {};
    this.botUsername = me.username || '';
    this.botId = parseInt(me.id, 10) || 0;
    this._log(`bot: @${this.botUsername} (id=${this.botId})`);

    if (!fs.existsSync(this.workdir)) {
      throw new Error(`Workdir not found: ${this.workdir}`);
    }

    for (const eng of [...VALID_ENGINES].sort()) {
      const p = whichSync(eng);
      this._log(`engine ${eng}: ${p || 'NOT FOUND'}`);
    }

    this._log(`config: default_engine=${this.defaultEngine} workdir=${this.workdir}`);
    this._log(`config: timeout=${this.runTimeout}s full_access=${this.codexFullAccess} claude_mode=${this.claudePermissionMode}`);
    if (this.allowedChatIds.size) {
      this._log(`config: allowed_ids=${[...this.allowedChatIds].sort()}`);
    } else {
      this._log('config: allowed_ids=ANY (no restriction)');
    }
  }

  async run() {
    this._acquireLock();
    process.on('SIGINT', () => this._handleSignal('SIGINT'));
    process.on('SIGTERM', () => this._handleSignal('SIGTERM'));
    await this.preflight();
    this._ensureSingleBot();
    this._startKeepAlive();

    try {
      const { TelegramChannel } = await import('./channel-telegram.js');
      const channel = new TelegramChannel(this);
      await channel.run();
    } finally {
      this._stopKeepAlive();
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const SUPPORTED_CHANNELS = new Set(['telegram']);
const PLANNED_CHANNELS = new Set(['slack', 'discord', 'dingtalk', 'feishu']);
const ALL_CHANNELS = new Set([...SUPPORTED_CHANNELS, ...PLANNED_CHANNELS]);

function parseArgs(argv) {
  const args = {
    channel: process.env.CODECLAW_CHANNEL || 'telegram',
    token: null,
    engine: null,
    model: null,
    workdir: null,
    fullAccess: null,
    safeMode: false,
    allowedIds: null,
    timeout: null,
    selfCheck: false,
    version: false,
    help: false,
  };

  const it = argv[Symbol.iterator]();
  for (const arg of it) {
    switch (arg) {
      case '-c': case '--channel': args.channel = it.next().value; break;
      case '-t': case '--token': args.token = it.next().value; break;
      case '-e': case '--engine': args.engine = it.next().value; break;
      case '-m': case '--model': args.model = it.next().value; break;
      case '-w': case '--workdir': args.workdir = it.next().value; break;
      case '--full-access': args.fullAccess = true; break;
      case '--safe-mode': args.safeMode = true; break;
      case '--allowed-ids': args.allowedIds = it.next().value; break;
      case '--timeout': args.timeout = parseInt(it.next().value, 10); break;
      case '--self-check': args.selfCheck = true; break;
      case '-v': case '--version': args.version = true; break;
      case '-h': case '--help': args.help = true; break;
      default:
        if (arg.startsWith('-')) {
          process.stderr.write(`Unknown option: ${arg}\n`);
          process.exit(1);
        }
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(`codeclaw — bridge AI coding agents to your IM.

Usage: codeclaw [options]
       npx codeclaw [options]

Connection:
  -c, --channel <ch>    IM channel (default: telegram)
  -t, --token <token>   Bot token

Engine:
  -e, --engine <eng>    AI engine: claude or codex (default: claude)
  -m, --model <model>   Model override
  -w, --workdir <dir>   Working directory (default: cwd)

Access control:
  --full-access         Agent runs without confirmation (default)
  --safe-mode           Require confirmation for destructive ops
  --allowed-ids <ids>   Comma-separated user/chat ID whitelist
  --timeout <secs>      Max seconds per request (default: 300)

Other:
  --self-check          Validate setup and exit
  -v, --version         Show version
  -h, --help            Show this help

Environment variables:
  CODECLAW_TOKEN          Bot token (same as -t)
  CODECLAW_WORKDIR        Working directory (same as -w)
  CODECLAW_TIMEOUT        Timeout in seconds (same as --timeout)
  DEFAULT_ENGINE          AI engine (same as -e)
  CLAUDE_MODEL            Claude model name
  CLAUDE_PERMISSION_MODE  bypassPermissions (default) or default
  CLAUDE_EXTRA_ARGS       Extra args passed to claude CLI
  CODEX_MODEL             Codex model name
  CODEX_REASONING_EFFORT  none | minimal | low | medium | high | xhigh
  CODEX_EXTRA_ARGS        Extra args passed to codex CLI

Examples:
  codeclaw -t $BOT_TOKEN
  codeclaw -t $BOT_TOKEN -e codex --safe-mode --allowed-ids 123456,789012
  codeclaw -t $BOT_TOKEN -m sonnet -w ~/projects/my-app
  codeclaw -t $BOT_TOKEN --self-check
`);
}

export async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.version) {
    process.stdout.write(`codeclaw ${VERSION}\n`);
    return 0;
  }

  if (args.help) {
    printHelp();
    return 0;
  }

  if (args.channel && !ALL_CHANNELS.has(args.channel)) {
    process.stderr.write(`Unknown channel: ${args.channel}\n`);
    return 1;
  }

  if (PLANNED_CHANNELS.has(args.channel)) {
    process.stderr.write(
      `[codeclaw] '${args.channel}' is planned but not yet implemented. Currently supported: ${[...SUPPORTED_CHANNELS].sort().join(', ')}\n`
    );
    return 1;
  }

  // Map CLI flags to env vars
  const token = args.token || process.env.CODECLAW_TOKEN || '';
  if (token) process.env.TELEGRAM_BOT_TOKEN = token;
  if (args.engine) process.env.DEFAULT_ENGINE = args.engine;
  if (args.workdir) process.env.CODECLAW_WORKDIR = args.workdir;
  if (args.model) {
    const engine = args.engine || process.env.DEFAULT_ENGINE || 'claude';
    if (engine === 'codex') {
      process.env.CODEX_MODEL = args.model;
    } else {
      process.env.CLAUDE_MODEL = args.model;
    }
  }
  if (args.allowedIds) process.env.TELEGRAM_ALLOWED_CHAT_IDS = args.allowedIds;
  if (args.timeout != null) process.env.CODECLAW_TIMEOUT = String(args.timeout);

  if (args.safeMode) {
    process.env.CODEX_FULL_ACCESS = 'false';
    process.env.CLAUDE_PERMISSION_MODE = 'default';
  } else if (args.fullAccess || envBool('CODECLAW_FULL_ACCESS', true)) {
    process.env.CODEX_FULL_ACCESS = 'true';
    process.env.CLAUDE_PERMISSION_MODE = 'bypassPermissions';
  }

  const claw = new CodeClaw();
  if (args.selfCheck) {
    claw._acquireLock();
    await claw.preflight();
    process.stdout.write('[codeclaw] ok\n');
    return 0;
  }

  await claw.run();
  return 0;
}
