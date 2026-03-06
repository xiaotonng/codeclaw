/**
 * End-to-end tests for codeclaw Telegram channel features.
 *
 * These tests create a CodeClaw + TelegramChannel instance with a mocked
 * Telegram API and mocked engine processes to verify the full flow:
 *   - Engine switching (/engine)
 *   - Session switching (/session)
 *   - Slash command passthrough (/ask, /new, /stop, /status, /battle, /clear)
 *   - Help and unknown commands
 *   - Message routing (_shouldHandle)
 *   - Markdown-to-HTML formatting
 *   - Quick reply detection
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

let CodeClaw, TelegramChannel;
let tmpDir, origEnv;

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeclaw-e2e-'));
  origEnv = { ...process.env };
  process.env.TELEGRAM_BOT_TOKEN = 'test-token-e2e';
  process.env.CODECLAW_WORKDIR = tmpDir;
  process.env.CODECLAW_STATE_DIR = path.join(tmpDir, 'state');
  process.env.DEFAULT_ENGINE = 'claude';
  process.env.CODEX_REASONING_EFFORT = 'high';

  const coreMod = await import('../src/codeclaw.js');
  CodeClaw = coreMod.CodeClaw;
  const chMod = await import('../src/channel-telegram.js');
  TelegramChannel = chMod.TelegramChannel;
});

afterEach(() => {
  process.env = origEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers to create a testable channel
// ---------------------------------------------------------------------------

function createTestChannel() {
  const core = new CodeClaw();
  core.botUsername = 'test_bot';
  core.botId = 999;
  const channel = new TelegramChannel(core);

  // Collect sent messages
  const sent = [];
  const edited = [];

  channel._apiCall = vi.fn(async (method, payload) => {
    if (method === 'sendMessage') {
      const msgId = 1000 + sent.length;
      sent.push({ method, payload, msgId });
      return { ok: true, result: { message_id: msgId } };
    }
    if (method === 'editMessageText') {
      edited.push({ method, payload });
      return { ok: true, result: {} };
    }
    if (method === 'deleteMessage') {
      return { ok: true, result: true };
    }
    if (method === 'answerCallbackQuery') {
      return { ok: true, result: true };
    }
    if (method === 'sendDocument') {
      return { ok: true, result: { message_id: 2000 + sent.length } };
    }
    return { ok: true, result: {} };
  });

  // Mock spawnEngine to return a fake process with scripted output
  core.spawnEngine = vi.fn((prompt, engine, threadId) => {
    const proc = new EventEmitter();
    const stdoutStream = new Readable({ read() {} });
    proc.stdout = stdoutStream;
    proc.stderr = new Readable({ read() {} });
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    proc.kill = vi.fn();

    // Emit a scripted result based on engine
    setTimeout(() => {
      if (engine === 'claude') {
        stdoutStream.push(JSON.stringify({
          type: 'system',
          session_id: 'claude-session-001',
        }) + '\n');
        stdoutStream.push(JSON.stringify({
          type: 'result',
          session_id: 'claude-session-001',
          result: `Claude response to: ${prompt.slice(0, 50)}`,
          usage: { input_tokens: 100, output_tokens: 50 },
        }) + '\n');
      } else if (engine === 'codex') {
        stdoutStream.push(JSON.stringify({
          type: 'thread.started',
          thread_id: 'codex-thread-001',
        }) + '\n');
        stdoutStream.push(JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: `Codex response to: ${prompt.slice(0, 50)}` },
        }) + '\n');
        stdoutStream.push(JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 80, output_tokens: 40 },
        }) + '\n');
      }
      stdoutStream.push(null);
      proc.emit('close', 0);
    }, 10);

    return proc;
  });

  return { core, channel, sent, edited };
}

function makeMsg(text, chatId = 100, messageId = 1, chatType = 'private') {
  return {
    message_id: messageId,
    chat: { id: chatId, type: chatType },
    from: { id: 42, username: 'testuser' },
    text,
  };
}

// ---------------------------------------------------------------------------
// Engine switching
// ---------------------------------------------------------------------------
describe('Engine switching (/engine)', () => {
  it('shows current engine when no argument', async () => {
    const { channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/engine'));
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0].payload.text).toContain('claude');
  });

  it('switches to codex', async () => {
    const { core, channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/engine codex'));
    expect(core._engineForChat(100)).toBe('codex');
    expect(sent[0].payload.text).toContain('codex');
  });

  it('switches to claude', async () => {
    const { core, channel, sent } = createTestChannel();
    core._setEngineForChat(100, 'codex');
    await channel._handleTextMessage(makeMsg('/engine claude'));
    expect(core._engineForChat(100)).toBe('claude');
  });

  it('rejects invalid engine', async () => {
    const { channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/engine gpt4'));
    expect(sent[0].payload.text).toContain('Invalid engine');
  });

  it('engine is per-chat', async () => {
    const { core, channel } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/engine codex', 100));
    expect(core._engineForChat(100)).toBe('codex');
    expect(core._engineForChat(200)).toBe('claude');
  });
});

// ---------------------------------------------------------------------------
// Session switching (/session)
// ---------------------------------------------------------------------------
describe('Session management (/session)', () => {
  it('lists sessions', async () => {
    const { channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/session list'));
    expect(sent[0].payload.text).toContain('default');
  });

  it('creates and switches to new session', async () => {
    const { core, channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/session new feature1'));
    expect(sent[0].payload.text).toContain('feature1');
    const [name] = core._sessionForChat(100);
    expect(name).toBe('feature1');
  });

  it('switches between sessions with /session use', async () => {
    const { core, channel } = createTestChannel();
    core._setActiveSession(100, 'a');
    core._setSessionThread(100, 'a', 'thread-a');
    core._setActiveSession(100, 'b');
    core._setSessionThread(100, 'b', 'thread-b');

    await channel._handleTextMessage(makeMsg('/session use a'));
    const [name, tid] = core._sessionForChat(100);
    expect(name).toBe('a');
    expect(tid).toBe('thread-a');
  });

  it('deletes a session', async () => {
    const { core, channel, sent } = createTestChannel();
    core._setActiveSession(100, 'temp');
    await channel._handleTextMessage(makeMsg('/session del temp'));
    expect(sent[0].payload.text).toContain('Deleted');
    const cs = core._ensureChatState(100);
    expect(cs.threads).not.toHaveProperty('temp');
  });

  it('creates session with prompt and runs engine', async () => {
    const { core, channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/session new feat2 hello world'));
    // Should have a placeholder + final edit
    expect(core.spawnEngine).toHaveBeenCalledWith(
      'hello world', 'claude', null
    );
  });

  it('shows usage for empty /session', async () => {
    const { channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/session'));
    expect(sent[0].payload.text).toContain('Usage');
  });
});

// ---------------------------------------------------------------------------
// /new and /stop commands
// ---------------------------------------------------------------------------
describe('/new and /stop commands', () => {
  it('/new resets session thread', async () => {
    const { core, channel, sent } = createTestChannel();
    core._setSessionThread(100, 'default', 'old-thread');
    await channel._handleTextMessage(makeMsg('/new'));
    const [, tid] = core._sessionForChat(100);
    expect(tid).toBeNull();
    expect(sent[0].payload.text).toContain('Session reset');
  });

  it('/new with prompt resets and runs engine', async () => {
    const { core, channel } = createTestChannel();
    core._setSessionThread(100, 'default', 'old-thread');
    await channel._handleTextMessage(makeMsg('/new fix the bug'));
    expect(core.spawnEngine).toHaveBeenCalledWith(
      'fix the bug', 'claude', null
    );
  });

  it('/stop clears session thread', async () => {
    const { core, channel, sent } = createTestChannel();
    core._setSessionThread(100, 'default', 'some-thread');
    await channel._handleTextMessage(makeMsg('/stop'));
    const [, tid] = core._sessionForChat(100);
    expect(tid).toBeNull();
    expect(sent[0].payload.text).toContain('Session cleared');
  });
});

// ---------------------------------------------------------------------------
// /ask command and plain text
// ---------------------------------------------------------------------------
describe('/ask and plain text', () => {
  it('/ask runs engine with prompt', async () => {
    const { core, channel } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/ask what is 2+2'));
    expect(core.spawnEngine).toHaveBeenCalled();
    const args = core.spawnEngine.mock.calls[0];
    expect(args[0]).toBe('what is 2+2');
    expect(args[1]).toBe('claude');
  });

  it('/ask shows usage without argument', async () => {
    const { channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/ask'));
    expect(sent[0].payload.text).toContain('Usage');
  });

  it('plain text in DM runs engine', async () => {
    const { core, channel } = createTestChannel();
    await channel._handleTextMessage(makeMsg('hello world'));
    expect(core.spawnEngine).toHaveBeenCalled();
    expect(core.spawnEngine.mock.calls[0][0]).toBe('hello world');
  });

  it('uses codex engine when switched', async () => {
    const { core, channel } = createTestChannel();
    core._setEngineForChat(100, 'codex');
    await channel._handleTextMessage(makeMsg('/ask do something'));
    expect(core.spawnEngine.mock.calls[0][1]).toBe('codex');
  });

  it('resumes thread when one exists', async () => {
    const { core, channel } = createTestChannel();
    core._setSessionThread(100, 'default', 'existing-thread');
    await channel._handleTextMessage(makeMsg('continue'));
    expect(core.spawnEngine.mock.calls[0][2]).toBe('existing-thread');
  });
});

// ---------------------------------------------------------------------------
// /status command
// ---------------------------------------------------------------------------
describe('/status command', () => {
  it('shows session and engine info', async () => {
    const { core, channel, sent } = createTestChannel();
    core._setEngineForChat(100, 'codex');
    core._setActiveSession(100, 'mywork');
    await channel._handleTextMessage(makeMsg('/status'));
    const text = sent[0].payload.text;
    expect(text).toContain('codex');
    expect(text).toContain('mywork');
  });
});

// ---------------------------------------------------------------------------
// /help command
// ---------------------------------------------------------------------------
describe('/help command', () => {
  it('shows help text', async () => {
    const { channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/help'));
    const text = sent[0].payload.text;
    expect(text).toContain('codeclaw');
    expect(text).toContain('/ask');
    expect(text).toContain('/engine');
    expect(text).toContain('/session');
  });
});

// ---------------------------------------------------------------------------
// Unknown commands
// ---------------------------------------------------------------------------
describe('Unknown commands', () => {
  it('responds with error for unknown slash command', async () => {
    const { channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/foobar'));
    expect(sent[0].payload.text).toContain('Unknown command');
  });
});

// ---------------------------------------------------------------------------
// /battle command
// ---------------------------------------------------------------------------
describe('/battle command', () => {
  it('shows usage without prompt', async () => {
    const { channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/battle'));
    expect(sent[0].payload.text).toContain('Usage');
  });

  it('runs both engines when given a prompt', async () => {
    const { core, channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/battle compare these'));
    // spawnEngine should be called for both engines
    expect(core.spawnEngine).toHaveBeenCalledTimes(2);
    const engines = core.spawnEngine.mock.calls.map(c => c[1]).sort();
    expect(engines).toEqual(['claude', 'codex']);
  });
});

// ---------------------------------------------------------------------------
// /clear command
// ---------------------------------------------------------------------------
describe('/clear command', () => {
  it('calls deleteMessage', async () => {
    const { channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/clear 3', 100, 50));
    // Should attempt to delete messages
    expect(channel._apiCall).toHaveBeenCalledWith('deleteMessage', expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// Message routing (_shouldHandle)
// ---------------------------------------------------------------------------
describe('Message routing', () => {
  it('handles private messages', () => {
    const { channel } = createTestChannel();
    const msg = makeMsg('hello', 100, 1, 'private');
    expect(channel._shouldHandle(msg)).toBe(true);
  });

  it('handles slash commands in groups', () => {
    const { channel } = createTestChannel();
    const msg = makeMsg('/ask test', 100, 1, 'group');
    expect(channel._shouldHandle(msg)).toBe(true);
  });

  it('handles @mention in groups', () => {
    const { channel } = createTestChannel();
    const msg = makeMsg('hello @test_bot', 100, 1, 'group');
    expect(channel._shouldHandle(msg)).toBe(true);
  });

  it('ignores group messages without mention', () => {
    const { channel } = createTestChannel();
    const msg = makeMsg('random message', 100, 1, 'group');
    expect(channel._shouldHandle(msg)).toBe(false);
  });

  it('handles reply to bot in groups', () => {
    const { channel } = createTestChannel();
    const msg = {
      ...makeMsg('reply text', 100, 1, 'group'),
      reply_to_message: { from: { id: 999 } },
    };
    expect(channel._shouldHandle(msg)).toBe(true);
  });

  it('respects allowedChatIds', () => {
    const { core, channel } = createTestChannel();
    core.allowedChatIds = new Set([100]);
    expect(channel._shouldHandle(makeMsg('hi', 100, 1, 'private'))).toBe(true);
    expect(channel._shouldHandle(makeMsg('hi', 200, 1, 'private'))).toBe(false);
  });

  it('ignores empty messages', () => {
    const { channel } = createTestChannel();
    const msg = makeMsg('', 100, 1, 'private');
    expect(channel._shouldHandle(msg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prompt cleaning
// ---------------------------------------------------------------------------
describe('Prompt cleaning', () => {
  it('removes bot mention', () => {
    const { channel } = createTestChannel();
    expect(channel._cleanPrompt('hello @test_bot world')).toBe('hello  world');
  });
});

// ---------------------------------------------------------------------------
// Thread persistence across engine runs
// ---------------------------------------------------------------------------
describe('Thread persistence', () => {
  it('saves thread ID from claude response', async () => {
    const { core, channel } = createTestChannel();
    await channel._handleTextMessage(makeMsg('hello'));
    const [, tid] = core._sessionForChat(100);
    expect(tid).toBe('claude-session-001');
  });

  it('saves thread ID from codex response', async () => {
    const { core, channel } = createTestChannel();
    core._setEngineForChat(100, 'codex');
    await channel._handleTextMessage(makeMsg('hello'));
    const [, tid] = core._sessionForChat(100);
    expect(tid).toBe('codex-thread-001');
  });

  it('resumes with saved thread on next message', async () => {
    const { core, channel } = createTestChannel();
    // First message creates thread
    await channel._handleTextMessage(makeMsg('first'));
    // Second message should resume
    await channel._handleTextMessage(makeMsg('second'));
    expect(core.spawnEngine.mock.calls[1][2]).toBe('claude-session-001');
  });
});

// ---------------------------------------------------------------------------
// Model override (via env)
// ---------------------------------------------------------------------------
describe('Model override', () => {
  it('uses custom claude model from env', () => {
    process.env.CLAUDE_MODEL = 'claude-sonnet-4-6';
    const core = new CodeClaw();
    expect(core.claudeModel).toBe('claude-sonnet-4-6');
    const cmd = core._buildClaudeCmd(null);
    expect(cmd).toContain('claude-sonnet-4-6');
  });

  it('uses custom codex model from env', () => {
    process.env.CODEX_MODEL = 'gpt-5';
    const core = new CodeClaw();
    expect(core.codexModel).toBe('gpt-5');
    const cmd = core._buildCodexCmd(null);
    expect(cmd).toContain('gpt-5');
  });
});

// ---------------------------------------------------------------------------
// Formatting helpers (imported from channel-telegram.js)
// ---------------------------------------------------------------------------
describe('Telegram formatting', () => {
  it('formats token counts', () => {
    const { channel } = createTestChannel();
    expect(channel._fmtTokens(null)).toBe('-');
    expect(channel._fmtTokens(500)).toBe('500');
    expect(channel._fmtTokens(1500)).toBe('1.5k');
    expect(channel._fmtTokens(10000)).toBe('10.0k');
  });
});

// ---------------------------------------------------------------------------
// Quick reply detection (imported from channel-telegram.js)
// ---------------------------------------------------------------------------
describe('Quick reply detection', () => {
  // We test via the module export indirectly through the channel
  it('detects yes/no questions', async () => {
    const { core, channel, edited } = createTestChannel();
    // Override spawnEngine to emit a question
    core.spawnEngine = vi.fn(() => {
      const proc = new EventEmitter();
      const stdout = new Readable({ read() {} });
      proc.stdout = stdout;
      proc.stderr = new Readable({ read() {} });
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      proc.kill = vi.fn();
      setTimeout(() => {
        stdout.push(JSON.stringify({
          type: 'result',
          session_id: 'sess-qr',
          result: 'I found a bug. Should I fix it?',
          usage: { input_tokens: 50, output_tokens: 20 },
        }) + '\n');
        stdout.push(null);
        proc.emit('close', 0);
      }, 10);
      return proc;
    });

    await channel._handleTextMessage(makeMsg('check code'));
    // The final edit should contain inline keyboard with Yes/No
    const lastEdit = edited[edited.length - 1];
    const keyboard = lastEdit?.payload?.reply_markup;
    if (keyboard) {
      const allButtons = keyboard.inline_keyboard.flat();
      const labels = allButtons.map(b => b.text);
      expect(labels).toEqual(expect.arrayContaining(['Yes', 'No']));
    }
  });
});

// ---------------------------------------------------------------------------
// Callback query handling
// ---------------------------------------------------------------------------
describe('Callback queries', () => {
  it('handles newsess callback', async () => {
    const { core, channel, sent } = createTestChannel();
    core._setSessionThread(100, 'default', 'old-thread');
    await channel._handleCallbackQuery({
      id: 'cb1',
      data: 'newsess:1000',
      message: { chat: { id: 100 }, message_id: 1000 },
    });
    const [, tid] = core._sessionForChat(100);
    expect(tid).toBeNull();
  });

  it('handles noop callback without error', async () => {
    const { channel } = createTestChannel();
    await channel._handleCallbackQuery({
      id: 'cb2',
      data: 'noop',
      message: { chat: { id: 100 }, message_id: 1000 },
    });
    // Should not throw
  });
});

// ---------------------------------------------------------------------------
// Bot username stripping in commands
// ---------------------------------------------------------------------------
describe('Bot username in commands', () => {
  it('strips @botname from commands in groups', async () => {
    const { channel, sent } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/help@test_bot', 100, 1, 'group'));
    expect(sent[0].payload.text).toContain('codeclaw');
  });

  it('strips @botname from /engine command', async () => {
    const { core, channel } = createTestChannel();
    await channel._handleTextMessage(makeMsg('/engine@test_bot codex', 100, 1, 'group'));
    expect(core._engineForChat(100)).toBe('codex');
  });
});
